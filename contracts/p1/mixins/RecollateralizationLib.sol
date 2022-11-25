// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/interfaces/IAsset.sol";
import "contracts/interfaces/IAssetRegistry.sol";
import "contracts/interfaces/ITrading.sol";
import "contracts/libraries/Fixed.sol";
import "./TradeLib.sol";

/// Struct purposes:
///   1. Stay under stack limit with fewer vars
///   2. Cache information such as component addresses + trading rules to save on gas

struct ComponentCache {
    ITrading trader;
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

    /// Select and prepare a trade that moves us closer to capitalization, using the
    /// basket range to avoid overeager/duplicate trading.
    // This is the "main loop" for recollateralization trading:
    // actions:
    //   let range = basketRange(all erc20s)
    //   let trade = nextTradePair(...)
    //   if trade.sell is not a defaulted collateral, prepareTradeToCoverDeficit(...)
    //   otherwise, prepareTradeSell(trade) with a 0 minBuyAmount
    function prepareRecollateralizationTrade(ITrading trader)
        external
        view
        returns (bool doTrade, TradeRequest memory req)
    {
        // === Prepare cached values ===

        IMain main = trader.main();
        ComponentCache memory components = ComponentCache({
            trader: trader,
            bh: main.basketHandler(),
            reg: main.assetRegistry(),
            stRSR: main.stRSR(),
            rsr: main.rsr(),
            rToken: main.rToken()
        });
        TradingRules memory rules = TradingRules({
            minTradeVolume: trader.minTradeVolume(),
            maxTradeSlippage: trader.maxTradeSlippage()
        });
        IERC20[] memory erc20s = components.reg.erc20s();

        // ============================

        // Compute basket range -  {BU}
        BasketRange memory range = basketRange(components, rules, erc20s);

        // Select a pair to trade next, if one exists
        TradeInfo memory trade = nextTradePair(components, rules, erc20s, range);

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

    // It's a precondition for all of these internal helpers that their `erc20s` argument contains at
    // least all basket collateral, plus any registered assets for which the BackingManager has a
    // nonzero balance. Any user of these functions should just pass in assetRegistry().erc20s(). We
    // would prefer to look it up from inside each function, and avoid the extra parameter to get
    // wrong, but the erc20s() call is pretty expensive.

    /// The plausible range of BUs that the BackingManager will own by the end of recapitalization.
    /// @param erc20s Assets this computation presumes may be traded to raise funds.
    //
    //
    // This function returns a "plausible range of BUs" assuming that the trading process follows
    //     the following rules:
    //
    // - We will not aim to hold more than rToken.basketsNeeded() BUs
    // - No double trades: if we buy B in one trade, we won't sell B in another trade
    // - The best amount of an asset we can sell is our balance minus any backing requirements;
    //       the worst is (our balance) - (backing requirement) - (its dust amount)
    // - The best price we might get for a trade is at the high sell price and low buy price
    // - The worst price we might get for a trade between assets is the current
    //     price estimate * ( 1 - maxTradeSlippage )
    // - The worst price we might get for an UNPRICED collateral is 0
    // - IFFY/DISABLED collateral are considered when they have nonzero price
    // - Given all that, we're aiming to hold as many BUs as possible using the assets we own.
    //
    // Given these assumptions, the following hold:
    //
    // range.top = min(rToken.basketsNeeded, totalAssetValue(erc20s).high / basket.price().high)
    //   because (totalAssetValue(erc20s).high / basket.price().high) is how many BUs we can hold
    //   given "best plausible" prices, and we won't hold more than rToken(trader).basketsNeeded
    //
    // range.bottom = max(0, min(lowBUs, range.top)), where:
    //   lowBUs = (assetsLow - maxTradeSlippage * buShortfall(range.top)) / basket.price().high
    //     is the number of BUs that we are *sure* we have the assets to collateralize
    //     (making the above assumptions about actual trade prices), and
    //   buShortfall(range.top) = the total value of the assets we'd need to buy in order
    //     in order to fully collateralize `range.top` BUs,
    //
    function basketRange(
        ComponentCache memory components,
        TradingRules memory rules,
        IERC20[] memory erc20s
    ) internal view returns (BasketRange memory range) {
        // basketPrice: The current UoA value of one basket.
        (uint192 basketPriceLow, uint192 basketPriceHigh) = components.bh.price();

        // assetsHigh: The most value we could get from the assets in erc20,
        //             assuming frictionless trades at currently-estimated prices.
        // assetsLow: The least value we might get from the assets in erc20,
        //            assuming frictionless trades, zero value from unreliable prices, and
        //            dustAmount of assets left in each Asset.
        // {UoA}
        (uint192 assetsLow, uint192 assetsHigh) = totalAssetValue(components, rules, erc20s);

        // {UoA}, Optimistic estimate of the value of our basket units at the end of this
        //   recapitalization process.
        uint192 basketTargetHigh = fixMin(
            assetsHigh,
            components.rToken.basketsNeeded().mul(basketPriceHigh)
        );

        // {UoA}, Total value of collateral in shortfall of `basketTargetHigh`. Specifically:
        //   sum( shortfall(c, basketTargetHigh / basketPriceHigh) for each erc20 c in the basket)
        //   where shortfall(c, BUs) == (BUs * bh.quantity(c) - c.bal(trader)) * c.price().high
        //         (that is, shortfall(c, BUs) is the market value of the c that `this` would
        //          need to be given in order to have enough of c to cover `BUs` BUs)
        // {UoA}
        uint192 shortfall = collateralShortfall(
            components,
            erc20s,
            basketTargetHigh,
            basketPriceHigh
        );

        // ==== Further adjust the low backing estimate downwards to account for trading frictions

        // {UoA}, Total value of the slippage we'd see if we made `shortfall` trades with
        //     slippage `maxTradeSlippage()`
        uint192 shortfallSlippage = rules.maxTradeSlippage.mul(shortfall);

        // {UoA}, Pessimistic estimate of the value of our basket units at the end of this
        //   recapitalization process.
        uint192 basketTargetLow = assetsLow.gt(shortfallSlippage)
            ? fixMin(assetsLow.minus(shortfallSlippage), basketTargetHigh)
            : 0;

        // {BU} = {UoA} / {BU/UoA}
        range.top = basketTargetHigh.div(basketPriceHigh, CEIL);
        range.bottom = basketTargetLow.div(basketPriceLow, CEIL);
    }

    // ===========================================================================================

    // === Private ===

    /// Total value of the erc20s under management by BackingManager
    /// This may include BackingManager's balances _and_ staked RSR held by stRSR
    /// @param erc20s tokens to consider "under management" by BackingManager in this computation
    /// @return assetsLow {UoA} The low estimate of the total value of assets under management
    /// @return assetsHigh {UoA} The high estimate of the total value of assets under management

    // preconditions:
    //   components.trader is backingManager
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
        IERC20[] memory erc20s
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
        for (uint256 i = 0; i < erc20s.length; ++i) {
            // Exclude RToken balances to avoid double counting value
            if (erc20s[i] == IERC20(address(components.rToken))) continue;

            IAsset asset = components.reg.toAsset(erc20s[i]);
            uint192 bal = asset.bal(address(components.trader)); // {tok}

            // For RSR, include the staking balance
            if (erc20s[i] == components.rsr) bal = bal.plus(asset.bal(address(components.stRSR)));

            (uint192 lowPrice, uint192 highPrice) = asset.price(); // {UoA/tok}

            uint192 lotPrice = fixMax(asset.fallbackPrice(), lowPrice); // {UoA/tok}

            uint192 qty = components.bh.quantity(erc20s[i]); // {tok/BU}

            // Ignore dust amounts for assets not in the basket; their value is inaccessible
            if (qty == 0 && !TradeLib.isEnoughToSell(bal, lotPrice, rules.minTradeVolume)) continue;

            // Intentionally include value of IFFY/DISABLED collateral when lowPrice is nonzero
            // {UoA} = {UoA} + {UoA/tok} * {tok}
            assetsLow = lowPrice.mul(bal, FLOOR);

            // {UoA} = {UoA} + {UoA/tok} * {tok}
            assetsHigh = highPrice.mul(bal, FLOOR);

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
        IERC20[] memory erc20s,
        BasketRange memory range
    ) private view returns (TradeInfo memory trade) {
        MaxSurplusDeficit memory maxes;
        maxes.surplusStatus = CollateralStatus.IFFY; // least-desirable sell status

        // No space on the stack to cache erc20s.length
        for (uint256 i = 0; i < erc20s.length; ++i) {
            if (erc20s[i] == components.rsr) continue;

            IAsset asset = components.reg.toAsset(erc20s[i]);

            uint192 bal = asset.bal(address(components.trader)); // {tok}

            // {tok} = {BU} * {tok/BU}
            // needed(Top): token balance needed for range.top baskets: quantity(e) * range.top
            uint192 needed = range.top.mul(components.bh.quantity(erc20s[i]), CEIL); // {tok}
            if (bal.gt(needed)) {
                // Assume worst-case price for selling asset
                (uint192 lowPrice, ) = asset.price(); // {UoA/tok}
                uint192 lotPrice = fixMax(asset.fallbackPrice(), lowPrice); // {UoA/tok}

                // {UoA} = {tok} * {UoA/tok}
                uint192 delta = bal.minus(needed).mul(lowPrice, FLOOR);

                // status = asset.status() if asset.isCollateral() else SOUND
                CollateralStatus status; // starts SOUND
                if (asset.isCollateral()) status = ICollateral(address(asset)).status();

                // Select the most-in-surplus "best" asset still enough to sell,
                // as defined by a (status, surplusAmt) ordering
                if (
                    isBetterSurplus(maxes, status, delta) &&
                    TradeLib.isEnoughToSell(bal.minus(needed), lotPrice, rules.minTradeVolume)
                ) {
                    trade.sell = asset;
                    trade.sellAmount = bal.minus(needed);
                    trade.sellPrice = lowPrice;

                    maxes.surplusStatus = status;
                    maxes.surplus = delta;
                }
            } else {
                // needed(Bottom): token balance needed at bottom of the basket range
                needed = range.bottom.mul(components.bh.quantity(erc20s[i]), CEIL); // {tok};
                if (bal.lt(needed)) {
                    uint192 amtShort = needed.minus(bal); // {tok}
                    (, uint192 highPrice) = asset.price(); // {UoA/tok}

                    // {UoA} = {tok} * {UoA/tok}
                    uint192 delta = amtShort.mul(highPrice, CEIL);

                    // The best asset to buy is whichever asset has the largest deficit
                    if (delta.gt(maxes.deficit)) {
                        trade.buy = ICollateral(address(asset));
                        trade.buyAmount = amtShort;
                        trade.buyPrice = highPrice;

                        maxes.deficit = delta;
                    }
                }
            }
        }

        // Use RSR if needed
        if (address(trade.sell) == address(0) && address(trade.buy) != address(0)) {
            IAsset rsrAsset = components.reg.toAsset(components.rsr);

            uint192 rsrAvailable = rsrAsset.bal(address(components.trader)).plus(
                rsrAsset.bal(address(components.stRSR))
            );
            (uint192 lowPrice, ) = rsrAsset.price(); // {UoA/tok}

            if (TradeLib.isEnoughToSell(rsrAvailable, lowPrice, rules.minTradeVolume)) {
                trade.sell = rsrAsset;
                trade.sellAmount = rsrAvailable;
                trade.sellPrice = lowPrice;
            }
        }
    }

    /// @param backingHigh {UoA} The high estimate for the amount of backing in UoA terms
    /// @param basketPriceHigh {UoA/BU} The high price of a BU in UoA terms
    /// @return shortfall {UoA} The missing re-collateralization in UoA terms
    // Specifically, returns:
    //   sum( shortfall(c, basketTargetHigh / basketPriceHigh) for each erc20 c in the basket)
    //   where shortfall(c,numBUs) == (numBus * bh.quantity(c) - c.balanceOf(bm)) * c.price().high
    //         (that is, shortfall(c, numBUs) is the market value of the c that `this` would
    //          need to be given in order to have enough of c to cover `numBUs` BUs)
    // precondition: erc20s contains no duplicates; all basket tokens are in erc20s
    function collateralShortfall(
        ComponentCache memory components,
        IERC20[] memory erc20s,
        uint192 backingHigh,
        uint192 basketPriceHigh
    ) private view returns (uint192 shortfall) {
        // TODO: do we really needed the precision of not collapsing backingHigh / basketPriceHigh

        assert(basketPriceHigh > 0); // div by zero further down in function

        // accumulate shortfall
        uint256 erc20sLen = erc20s.length;
        for (uint256 i = 0; i < erc20sLen; ++i) {
            uint192 quantity = components.bh.quantity(erc20s[i]); // {tok/BU}
            if (quantity == 0) continue; // skip non-basket collateral

            // if the quantity is nonzero, then it must be collateral
            ICollateral coll = components.reg.toColl(erc20s[i]);

            // {tok} = {UoA} * {tok/BU} / {UoA/BU}
            // needed: quantity of erc20s[i] needed in basketPriceHigh's worth of baskets
            uint192 needed = backingHigh.mulDiv(quantity, basketPriceHigh, CEIL); // {tok}
            // held: quantity of erc20s[i] owned by the trader (BackingManager)
            uint192 held = coll.bal(address(components.trader)); // {tok}

            if (held.lt(needed)) {
                (, uint192 priceHigh) = coll.price(); // {UoA/tok}

                // {UoA} = {UoA} + ({tok} - {tok}) * {UoA/tok}
                shortfall = shortfall.plus(needed.minus(held).mul(priceHigh, FLOOR));
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
