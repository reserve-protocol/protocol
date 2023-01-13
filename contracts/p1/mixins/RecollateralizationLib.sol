// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../../interfaces/IAsset.sol";
import "../../interfaces/IAssetRegistry.sol";
import "../../interfaces/IBackingManager.sol";
import "../../libraries/Fixed.sol";
import "./TradeLib.sol";

/// Struct purposes:
///   1. Stay under stack limit with fewer vars
///   2. Cache information such as component addresses + trading rules to save on gas

struct ComponentCache {
    IBackingManager bm;
    IBasketHandler bh;
    IAssetRegistry reg;
    IStRSR stRSR;
    IERC20 rsr;
    IRToken rToken;
}

struct TradingRules {
    uint192 minTradeVolume; // {UoA}
    uint192 maxTradeSlippage; // {1}
}

struct TradeInfo {
    IAsset sell;
    IAsset buy;
    uint192 sellAmount; // {sellTok}
    uint192 buyAmount; // {buyTok}
    uint192 sellPrice; // {UoA/sellTok} can be 0
    uint192 buyPrice; // {UoA/buyTok}
}

/**
 * @title RecollateralizationLibP1
 * @notice An informal extension of the Trading mixin that provides trade preparation views
 *   Users:
 *     - BackingManager
 *     - RTokenAsset
 *
 * Interface:
 *  1. prepareRecollateralizationTrade (external)
 *  2. basketRange (internal)
 */
library RecollateralizationLibP1 {
    using FixLib for uint192;
    using TradeLib for TradeInfo;
    using TradeLib for IBackingManager;

    /// Select and prepare a trade that moves us closer to capitalization, using the
    /// basket range to avoid overeager/duplicate trading.
    // This is the "main loop" for recollateralization trading:
    // actions:
    //   let range = basketRange(all erc20s)
    //   let trade = nextTradePair(...)
    //   if trade.sell is not a defaulted collateral, prepareTradeToCoverDeficit(...)
    //   otherwise, prepareTradeSell(trade) with a 0 minBuyAmount
    function prepareRecollateralizationTrade(IBackingManager bm)
        external
        view
        returns (bool doTrade, TradeRequest memory req)
    {
        // === Prepare cached values ===

        IMain main = bm.main();
        ComponentCache memory components = ComponentCache({
            bm: bm,
            bh: main.basketHandler(),
            reg: main.assetRegistry(),
            stRSR: main.stRSR(),
            rsr: main.rsr(),
            rToken: main.rToken()
        });
        TradingRules memory rules = TradingRules({
            minTradeVolume: bm.minTradeVolume(),
            maxTradeSlippage: bm.maxTradeSlippage()
        });

        Registry memory reg = components.reg.getRegistry();

        // ============================

        // Compute basket range -  {BU}
        BasketRange memory range = basketRange(components, rules, reg);

        // Select a pair to trade next, if one exists
        TradeInfo memory trade = nextTradePair(components, rules, reg, range);

        // Don't trade if no pair is selected
        if (address(trade.sell) == address(0) || address(trade.buy) == address(0)) {
            return (false, req);
        }

        // If we are selling an unpriced asset or UNSOUND collateral, do not try to cover deficit
        if (
            trade.sellPrice == 0 ||
            (trade.sell.isCollateral() &&
                ICollateral(address(trade.sell)).status() != CollateralStatus.SOUND)
        ) {
            (doTrade, req) = trade.prepareTradeSell(rules);
        } else {
            (doTrade, req) = trade.prepareTradeToCoverDeficit(rules);
        }

        // At this point doTrade _must_ be true, otherwise nextTradePair assumptions are broken
        assert(doTrade);

        return (doTrade, req);
    }

    // Used to avoid stack-too-deep errors in basketRange
    struct BasketRange {
        uint192 top; // {BU}
        uint192 bottom; // {BU}
    }

    // It's a precondition for all below internal helpers that their `erc20s` argument contains at
    // least all basket collateral, plus any registered assets for which the BackingManager has a
    // nonzero balance. Any user of these functions should just pass in assetRegistry().erc20s(). We
    // would prefer to look it up from inside each function, and avoid the extra parameter to get
    // wrong, but the erc20s() call is pretty expensive.

    // This function returns a "plausible range of BUs" assuming that the trading process follows
    //     the following rules:
    //
    // - We will not aim to hold more than rToken.basketsNeeded() BUs
    // - No double trades: if we buy B in one trade, we won't sell B in another trade
    //       Caveat: Unless the asset we're selling is IFFY/DISABLED
    // - The best amount of an asset we can sell is our balance minus any backing requirements;
    //       the worst is (our balance) - (backing requirement) - (its dust amount)
    // - The best price we might get for a trade is at the high sell price and low buy price
    // - The worst price we might get for a trade between assets is at the low sell price and
    //     the high buy price, multiplied by ( 1 - maxTradeSlippage )
    // - Given all that, we're aiming to hold as many BUs as possible using the assets we own.
    //
    // Given these assumptions, the following hold:
    //
    // range.top = min(rToken.basketsNeeded, totalAssetValue(erc20s).high / basket.price().low)
    //   because (totalAssetValue(erc20s).high / basket.price().low) is how many BUs we can hold
    //   given "best plausible" prices, and we shouldn't hold more than rToken(bm).basketsNeeded
    //
    // range.bottom = max(0, min(lowBUs, range.top)), where:
    //   lowBUs = (assetsLow - maxTradeSlippage * buShortfall(range.top)) / basket.price().high
    //     is the number of BUs that we are *sure* we have the assets to collateralize, and
    //   buShortfall(range.top) = the total value of the assets we'd need to buy in order
    //     in order to fully collateralize `range.top` BUs,
    //
    function basketRange(
        ComponentCache memory components,
        TradingRules memory rules,
        Registry memory reg
    ) internal view returns (BasketRange memory range) {
        // basketPrice: The current UoA value of one basket.
        (uint192 basketPriceLow, uint192 basketPriceHigh) = components.bh.price();

        // assetsHigh: The most value we could get from the assets in erc20,
        //             assuming frictionless trades at currently-estimated prices.
        // assetsLow: The least value we might get from the assets in erc20,
        //            assuming frictionless trades, zero value from unreliable prices, and
        //            dustAmount of assets left in each Asset.
        // {UoA}
        (uint192 assetsLow, uint192 assetsHigh) = totalAssetValue(components, rules, reg);

        // ==== Calculate range.top ====

        // basketsHigh: The most amount of BUs we could possibly get from `assetsHigh`
        // {BU} = {1} * {UoA} / {UoA/BU}
        uint192 basketsHigh = components.bm.safeMulDivCeil(FIX_ONE, assetsHigh, basketPriceLow);

        // range.top: The most amount of BUs we should possibly aim to hold
        range.top = fixMin(basketsHigh, components.rToken.basketsNeeded());

        // ==== Calculate range.bottom ====

        // shortfall: The total value of collateral in shortfall of `range.top`. Specifically:
        //   sum( shortfall(c, range.top) for each erc20 c in the basket)
        //   where shortfall(c, BUs) == (BUs * bh.quantity(c) - c.bal(bm)) * c.price().high
        //         (that is, shortfall(c, BUs) is the market value of the c that `this` would
        //          need to be given in order to have enough of c to cover `range.top` BUs)
        // {UoA}
        uint192 shortfall = collateralShortfall(components, range.top);

        // shortfallSlippage: The total amount of slippage we'd see if we took max slippage
        //                    while trading `shortfall` value
        // {UoA} = {1} * {UoA} / {1}
        uint192 shortfallSlippage = rules.maxTradeSlippage.mulDiv(
            shortfall,
            FIX_ONE.minus(rules.maxTradeSlippage),
            CEIL
        );

        // Take shortfallSlippage out of assetsLow
        assetsLow = assetsLow.gt(shortfallSlippage) ? assetsLow.minus(shortfallSlippage) : 0;

        // range.bottom: The least amount of BUs we could possibly end up holding after trading
        // {BU} = {UoA} / {UoA/BU}
        range.bottom = fixMin(assetsLow.div(basketPriceHigh, CEIL), range.top);
    }

    // ===========================================================================================

    // === Private ===

    /// Total value of the erc20s under management by BackingManager
    /// This may include BackingManager's balances _and_ staked RSR held by stRSR
    /// @param reg ERC20/Asset registry "under management" by BackingManager in this computation
    /// @return assetsLow {UoA} The low estimate of the total value of assets under management
    /// @return assetsHigh {UoA} The high estimate of the total value of assets under management

    // preconditions:
    //   components.bm is backingManager
    //   erc20s has no duplicates
    // checks:
    //   for e in erc20s, e has a registered asset in the assetRegistry
    // return values:
    // assetsHigh: The most value we could get from the assets in erc20,
    //             assuming frictionless trades at best-case prices.
    // assetsLow: The least value we might get from the assets in erc20,
    //            assuming frictionless trades at worst-case prices,
    //            zero value from unpriceable assets, and
    //            dustAmount of assets left behind for each Asset.
    function totalAssetValue(
        ComponentCache memory components,
        TradingRules memory rules,
        Registry memory reg
    ) private view returns (uint192 assetsLow, uint192 assetsHigh) {
        // The low estimate is lower than the high estimate due to:
        // - Using worst-case prices rather than best-case (price().low instead of price().high)
        // - Discounting assets with unbounded worst-case price
        // - Discounting dust amounts for collateral in the basket + non-dust assets

        uint192 potentialDustLoss; // {UoA}

        // Accumulate:
        // - assetsHigh: sum(bal(e)*price(e).high for e ... )
        // - potentialDustLoss: sum(minTradeVolume(e) for e ... )
        // - assetsLow: sum(bal(e)*price(e).low for e ... )
        for (uint256 i = 0; i < reg.erc20s.length; ++i) {
            // Exclude RToken balances to avoid double counting value
            if (reg.erc20s[i] == IERC20(address(components.rToken))) continue;

            uint192 bal = reg.assets[i].bal(address(components.bm)); // {tok}

            // For RSR, include the staking balance
            if (reg.erc20s[i] == components.rsr) {
                bal = bal.plus(reg.assets[i].bal(address(components.stRSR)));
            }

            (uint192 low, uint192 high) = reg.assets[i].price(); // {UoA/tok}
            (uint192 lotLow, ) = reg.assets[i].lotPrice(); // {UoA/tok}

            // Ignore dust amounts for assets not in the basket; their value is inaccessible
            if (
                components.bh.quantity(reg.erc20s[i]) == 0 &&
                !TradeLib.isEnoughToSell(reg.assets[i], bal, lotLow, rules.minTradeVolume)
            ) continue;

            // Intentionally include value of IFFY/DISABLED collateral when low is nonzero
            // {UoA} = {UoA} + {UoA/tok} * {tok}
            assetsLow += low.mul(bal, FLOOR);
            // += is same as Fix.plus

            // assetsHigh += high.mul(bal, CEIL), where assetsHigh is [0, FIX_MAX]
            // {UoA} = {UoA/tok} * {tok}
            uint192 val = components.bm.safeMulDivCeil(high, bal, FIX_ONE);
            if (uint256(assetsHigh) + val >= FIX_MAX) assetsHigh = FIX_MAX;
            else assetsHigh += val;
            // += is same as Fix.plus

            // Accumulate potential losses to dust
            potentialDustLoss = potentialDustLoss.plus(rules.minTradeVolume);
        }

        // Account for all the places dust could get stuck
        // assetsLow' = max(assetsLow-potentialDustLoss, 0)
        assetsLow = assetsLow.gt(potentialDustLoss) ? assetsLow.minus(potentialDustLoss) : FIX_ZERO;
    }

    // Used in memory in `nextTradePair` to duck the stack limit
    struct MaxSurplusDeficit {
        CollateralStatus surplusStatus; // starts SOUND
        uint192 surplus; // {UoA}
        uint192 deficit; // {UoA}
    }

    // Choose next sell/buy pair to trade, with reference to the basket range
    // Skip over trading surplus dust amounts
    /// @return trade
    ///   sell: Surplus collateral OR address(0)
    ///   deficit Deficit collateral OR address(0)
    ///   sellAmount {sellTok} Surplus amount (whole tokens)
    ///   buyAmount {buyTok} Deficit amount (whole tokens)
    ///   sellPrice {UoA/sellTok} The worst-case price of the sell token on secondary markets
    ///   buyPrice {UoA/sellTok} The worst-case price of the buy token on secondary markets
    ///
    // Defining "sell" and "buy":
    // If bal(e) > (quantity(e) * range.top), then e is in surplus by the difference
    // If bal(e) < (quantity(e) * range.bottom), then e is in deficit by the difference
    //
    // First, ignoring RSR:
    //   `trade.sell` is the token from erc20s with the greatest surplus value (in UoA),
    //   and sellAmount is the quantity of that token that it's in surplus (in qTok).
    //   if `trade.sell` == 0, then no token is in surplus by at least minTradeSize,
    //        and `trade.sellAmount` and `trade.sellPrice` are unset.
    //
    //   `trade.buy` is the token from erc20s with the greatest deficit value (in UoA),
    //   and buyAmount is the quantity of that token that it's in deficit (in qTok).
    //   if `trade.buy` == 0, then no token is in deficit at all,
    //        and `trade.buyAmount` and `trade.buyPrice` are unset.
    //
    // Then, just if we have a buy asset and no sell asset, consider selling available RSR.
    //
    // Prefer selling assets in this order: DISABLED -> SOUND -> IFFY.
    // All collateral in the basket have already been guaranteed to be SOUND by upstream checks.
    function nextTradePair(
        ComponentCache memory components,
        TradingRules memory rules,
        Registry memory reg,
        BasketRange memory range
    ) private view returns (TradeInfo memory trade) {
        MaxSurplusDeficit memory maxes;
        maxes.surplusStatus = CollateralStatus.IFFY; // least-desirable sell status

        // No space on the stack to cache erc20s.length
        for (uint256 i = 0; i < reg.erc20s.length; ++i) {
            if (reg.erc20s[i] == components.rsr) continue;

            uint192 bal = reg.assets[i].bal(address(components.bm)); // {tok}

            // {tok} = {BU} * {tok/BU}
            // needed(Top): token balance needed for range.top baskets: quantity(e) * range.top
            uint192 needed = range.top.mul(components.bh.quantity(reg.erc20s[i]), CEIL); // {tok}
            if (bal.gt(needed)) {
                uint192 low; // {UoA/sellTok}

                // this wonky block is just for getting around the stack limit
                {
                    uint192 high; // {UoA/sellTok}
                    (low, high) = reg.assets[i].price(); // {UoA/sellTok}

                    // Skip worthless assets
                    if (high == 0) continue;
                }

                (uint192 lotLow, ) = reg.assets[i].lotPrice(); // {UoA/sellTok}

                // {UoA} = {sellTok} * {UoA/sellTok}
                uint192 delta = bal.minus(needed).mul(lotLow, FLOOR);

                // status = asset.status() if asset.isCollateral() else SOUND
                CollateralStatus status; // starts SOUND
                if (reg.assets[i].isCollateral()) {
                    status = ICollateral(address(reg.assets[i])).status();
                }

                // Select the most-in-surplus "best" asset still enough to sell,
                // as defined by a (status, surplusAmt) ordering
                if (
                    isBetterSurplus(maxes, status, delta) &&
                    TradeLib.isEnoughToSell(
                        reg.assets[i],
                        bal.minus(needed),
                        lotLow,
                        rules.minTradeVolume
                    )
                ) {
                    trade.sell = reg.assets[i];
                    trade.sellAmount = bal.minus(needed);
                    trade.sellPrice = low;

                    maxes.surplusStatus = status;
                    maxes.surplus = delta;
                }
            } else {
                // needed(Bottom): token balance needed at bottom of the basket range
                needed = range.bottom.mul(components.bh.quantity(reg.erc20s[i]), CEIL); // {buyTok};
                if (bal.lt(needed)) {
                    uint192 amtShort = needed.minus(bal); // {buyTok}
                    (, uint192 high) = reg.assets[i].price(); // {UoA/buyTok}

                    // {UoA} = {buyTok} * {UoA/buyTok}
                    uint192 delta = amtShort.mul(high, CEIL);

                    // The best asset to buy is whichever asset has the largest deficit
                    if (delta.gt(maxes.deficit)) {
                        trade.buy = ICollateral(address(reg.assets[i]));
                        trade.buyAmount = amtShort;
                        trade.buyPrice = high;

                        maxes.deficit = delta;
                    }
                }
            }
        }

        // Use RSR if needed
        if (address(trade.sell) == address(0) && address(trade.buy) != address(0)) {
            IAsset rsrAsset = components.reg.toAsset(components.rsr);

            uint192 rsrAvailable = rsrAsset.bal(address(components.bm)).plus(
                rsrAsset.bal(address(components.stRSR))
            );
            (uint192 low, uint192 high) = rsrAsset.price(); // {UoA/tok}
            (uint192 lotLow, ) = rsrAsset.lotPrice(); // {UoA/tok}

            if (
                high > 0 &&
                TradeLib.isEnoughToSell(rsrAsset, rsrAvailable, lotLow, rules.minTradeVolume)
            ) {
                trade.sell = rsrAsset;
                trade.sellAmount = rsrAvailable;
                trade.sellPrice = low;
            }
        }
    }

    /// @param basketsTop {BU} The top end of the basket range estimate
    /// @return shortfall {UoA} The missing re-collateralization in UoA terms
    // Specifically, returns:
    //   sum( shortfall(c, basketsLow) for each backing erc20 c in the basket)
    //   where shortfall(c,numBUs) == (numBus * bh.quantity(c) - c.balanceOf(bm)) * c.price().high
    //         (that is, shortfall(c, numBUs) is the market value of the c that `this` would
    //          need to be given in order to have enough of c to cover `basketsTop` BUs)
    function collateralShortfall(ComponentCache memory components, uint192 basketsTop)
        private
        view
        returns (uint192 shortfall)
    {
        IERC20[] memory basketERC20s = components.bh.basketTokens();
        uint256 len = basketERC20s.length;

        // accumulate shortfall
        for (uint256 i = 0; i < len; ++i) {
            uint192 q = components.bh.quantity(basketERC20s[i]);
            if (q == 0) continue; // can happen if current basket is out of sync with registry

            // {tok} = {BU} * {tok/BU}
            // needed: quantity of erc20 needed for `basketsTop` BUs
            uint192 needed = basketsTop.mul(q, CEIL); // {tok}

            ICollateral coll = components.reg.toColl(basketERC20s[i]);

            // held: quantity of erc20 owned by the bm (BackingManager)
            uint192 held = coll.bal(address(components.bm)); // {tok}

            if (held.lt(needed)) {
                // use the high estimate because it is the worst-case cost of acquisition
                (, uint192 priceHigh) = coll.price(); // {UoA/tok}

                // {UoA} = {UoA} + ({tok} - {tok}) * {UoA/tok}
                shortfall = shortfall.plus(needed.minus(held).mul(priceHigh, CEIL));
            }
        }
    }

    /// @param curr The current MaxSurplusDeficit containing the best surplus so far
    /// @param other The collateral status of the asset in consideration
    /// @param surplusAmt {UoA} The amount by which the asset in consideration is in surplus
    function isBetterSurplus(
        MaxSurplusDeficit memory curr,
        CollateralStatus other,
        uint192 surplusAmt
    ) private pure returns (bool) {
        // NOTE: If the CollateralStatus enum changes then this has to change!
        if (curr.surplusStatus == CollateralStatus.DISABLED) {
            return other == CollateralStatus.DISABLED && surplusAmt.gt(curr.surplus);
        } else if (curr.surplusStatus == CollateralStatus.SOUND) {
            return
                other == CollateralStatus.DISABLED ||
                (other == CollateralStatus.SOUND && surplusAmt.gt(curr.surplus));
        } else {
            // curr is IFFY
            return other != CollateralStatus.IFFY || surplusAmt.gt(curr.surplus);
        }
    }
}
