// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../../interfaces/IAsset.sol";
import "../../interfaces/IAssetRegistry.sol";
import "../../interfaces/ITrading.sol";
import "../../libraries/Fixed.sol";
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
    uint192 sellPrice; // {UoA/sellTok}
    uint192 buyPrice; // {UoA/buyTok}
}

/**
 * @title RecollateralizationLibP1
 * @notice An informal extension of the Trading mixin that provides trade preparation views
 *   Users:
 *     - BackingManager
 *     - RTokenAsset
 *
 * @dev The caller must implement the ITrading interface!
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

        // If we are selling UNSOUND collateral, eliminate the minBuyAmount requirement
        if (
            trade.sell.isCollateral() &&
            ICollateral(address(trade.sell)).status() != CollateralStatus.SOUND
        ) {
            (doTrade, req) = trade.prepareTradeSell(rules);
            req.minBuyAmount = 0;
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

    // It's a precondition for all of these private helpers that their `erc20s` argument contains at
    // least all basket collateral, plus any registered assets for which the BackingManager has a
    // nonzero balance. Any user of these functions should just pass in assetRegistry().erc20s(). We
    // would prefer to look it up from inside each function, and avoid the extra parameter to get
    // wrong, but the erc20s() call is pretty expensive.

    /// The plausible range of BUs that the BackingManager will own by the end of recapitalization.
    /// @param erc20s Assets this computation presumes may be traded to raise funds.
    //
    //
    // This function returns a "plausible range of BUs" assuming that the trading process follows
    //     the follwing rules:
    //
    // - We will not aim to hold more than rToken.basketsNeeded() BUs
    // - No double trades: if we buy B in one trade, we won't sell B in another trade
    // - The best amount of an asset we can sell is our balance;
    //       the worst is (our balance) - (its dust amount)
    // - The best price we might get for a trade is the current price estimate (frictionlessly)
    // - The worst price we might get for a trade between SOUND or IFFY collateral is the current
    //     price estimate * ( 1 - maxTradeSlippage )
    // - The worst price we might get for an UNPRICED or DISABLED collateral is 0.
    // - Given all that, we're aiming to hold as many BUs as possible using the assets we own.
    //
    // Given these assumptions, the following hold:
    //
    // range.top = min(rToken.basketsNeeded, totalAssetValue(erc20s).high / basket.price())
    //   because (totalAssetValue(erc20s).high / basket.price()) is how many BUs we can hold given
    //   "best plausible" prices, and we won't try to hold more than rToken(trader).basketsNeeded
    //
    // range.bottom = max(0, min(pessimisticBUs, range.top)), where:
    //   pessimisticBUs = (assetsLow - maxTradeSlippage * buShortfall(range.top)) / basket.price()
    //     is the number of BUs that we are *sure* we have the assets to collateralize
    //     (making the above assumptions about actual trade prices), and
    //   buShortfall(range.top) = the total value of the assets we'd need to buy in order
    //     in order to fully collataeralize `range.top` BUs,
    //
    function basketRange(
        ComponentCache memory components,
        TradingRules memory rules,
        IERC20[] memory erc20s
    ) internal view returns (BasketRange memory range) {
        // basketPrice: The current UoA value of one basket.
        (, uint192 basketPrice) = components.bh.price(true);

        // assetsHigh: The most value we could get from the assets in erc20,
        //             assuming frictionless trades at currently-estimated prices.
        // assetsLow: The least value we might get from the assets in erc20,
        //            assuming frictionless trades, zero value from unreliable prices, and
        //            dustAmount of assets left in each Asset.
        // {UoA}
        (uint192 assetsHigh, uint192 assetsLow) = totalAssetValue(components, rules, erc20s);

        // {UoA}, Optimistic estimate of the value of our basket units at the end of this
        //   recapitalization process.
        uint192 basketTargetHigh = fixMin(
            assetsHigh,
            components.rToken.basketsNeeded().mul(basketPrice)
        );

        // {UoA}, Total value of collateral in shortfall of `basketTargetHigh`. Specifically:
        //   sum( shortfall(c, basketTargetHigh / basketPrice) for each erc20 c in the basket)
        //   where shortfall(c, BUs) == (BUs * bh.quantity(c) - c.balanceOf(trader)) * c.price()
        //         (that is, shortfall(c, BUs) is the market value of the c that `this` would
        //          need to be given in order to have enough of c to cover `BUs` BUs)
        // {UoA}
        uint192 shortfall = collateralShortfall(components, erc20s, basketTargetHigh, basketPrice);

        // ==== Further adjust the low backing estimate downwards to account for trading frictions

        // {UoA}, Total value of the slippage we'd see if we made `shortfall` trades with
        //     slippage `maxTradeSlippage()`
        uint192 shortfallSlippage = rules.maxTradeSlippage.mul(shortfall);

        // {UoA}, Pessimistic estimate of the value of our basket units at the end of this
        //   recapitalization process.
        uint192 basketTargetLow = assetsLow.gt(shortfallSlippage)
            ? fixMin(assetsLow.minus(shortfallSlippage), basketTargetHigh)
            : 0;

        // {BU} = {UoA} / {UoA/BU}
        range.top = basketTargetHigh.div(basketPrice, CEIL);
        range.bottom = basketTargetLow.div(basketPrice, CEIL);
    }

    // ===========================================================================================

    // === Private ===

    /// Total value of the erc20s under management by BackingManager
    /// This may include BackingManager's balances _and_ staked RSR hold by stRSR
    /// @param erc20s tokens to consider "under management" by BackingManager in this computation
    /// @return assetsHigh {UoA} The high estimate of the total value of assets under management
    /// @return assetsLow {UoA} The low estimate of the total value of assets under management

    // preconditions:
    //   components.trader is backingManager
    //   erc20s has no duplicates
    // checks:
    //   for e in erc20s, e has a registered asset in the assetRegistry
    // return values:
    // assetsHigh: The most value we could get from the assets in erc20,
    //             assuming frictionless trades at currently-estimated prices.
    // assetsLow: The least value we might get from the assets in erc20,
    //            assuming frictionless trades, zero value from unreliable prices, and
    //            dustAmount of assets left in each Asset.
    function totalAssetValue(
        ComponentCache memory components,
        TradingRules memory rules,
        IERC20[] memory erc20s
    ) private view returns (uint192 assetsHigh, uint192 assetsLow) {
        // The low estimate is lower than the high estimate due to:
        // - Discounting assets with reverting strict prices
        // - Discounting dust amounts for collateral in the basket + non-dust assets

        uint192 potentialDustLoss; // {UoA}

        // Accumulate:
        // - assetsHigh: sum(bal(e)*price(e) for e ... )
        // - potentialDustLoss: sum(minTradeSize(e) for e ... )
        // - assetsLow: sum(bal(e)*price(e) for e ... if e.status() == SOUND or e is just an Asset)
        for (uint256 i = 0; i < erc20s.length; ++i) {
            // Exclude RToken balances, or else we double count
            if (erc20s[i] == IERC20(address(components.rToken))) continue;

            IAsset asset = components.reg.toAsset(erc20s[i]);
            uint192 bal = asset.bal(address(components.trader));

            // For RSR, include the staking balance
            if (erc20s[i] == components.rsr) bal = bal.plus(asset.bal(address(components.stRSR)));

            // Ignore dust amounts for assets not in the basket; their value is inaccessible
            bool inBasket = components.bh.quantity(erc20s[i]).gt(FIX_ZERO);
            (bool isFallback, uint192 price) = asset.price(true); // {UoA}
            if (!inBasket && !TradeLib.isEnoughToSell(asset, price, bal, rules.minTradeVolume)) {
                continue;
            }

            // {UoA} = {UoA} + {UoA/tok} * {tok}
            uint192 val = price.mul(bal, FLOOR);

            // Consider all managed assets at face-value prices
            assetsHigh = assetsHigh.plus(val);

            // Accumulate potential losses to dust
            potentialDustLoss = potentialDustLoss.plus(rules.minTradeVolume);

            // Consider only reliable sources of value for the assetsLow estimate
            if (!isFallback) {
                assetsLow = assetsLow.plus(val);
            }
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
    // Exclude dust amounts for surplus
    /// @return trade
    ///   sell: Surplus collateral OR address(0)
    ///   deficit Deficit collateral OR address(0)
    ///   sellAmount {sellTok} Surplus amount (whole tokens)
    ///   buyAmount {buyTok} Deficit amount (whole tokens)
    ///   sellPrice {UoA/sellTok}
    ///   buyPrice {UoA/sellTok}
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
    function nextTradePair(
        ComponentCache memory components,
        TradingRules memory rules,
        IERC20[] memory erc20s,
        BasketRange memory range
    ) private view returns (TradeInfo memory trade) {
        MaxSurplusDeficit memory maxes;
        maxes.surplusStatus = CollateralStatus.IFFY; // least-desirable sell status

        for (uint256 i = 0; i < erc20s.length; ++i) {
            if (erc20s[i] == components.rsr) continue;

            IAsset asset = components.reg.toAsset(erc20s[i]);

            uint192 bal = asset.bal(address(components.trader)); // {tok}

            // {tok} = {BU} * {tok/BU}
            // needed(Top): token balance needed for range.top baskets: quantity(e) * range.top
            uint192 needed = range.top.mul(components.bh.quantity(erc20s[i]), CEIL); // {tok}
            if (bal.gt(needed)) {
                (, uint192 price_) = asset.price(true); // {UoA/tok} allow fallback prices

                // {UoA} = {tok} * {UoA/tok}
                uint192 delta = bal.minus(needed).mul(price_, FLOOR);

                CollateralStatus status; // starts SOUND
                if (asset.isCollateral()) status = ICollateral(address(asset)).status();

                // Select the most-in-surplus "best" asset, as defined by (status, max surplusAmt)
                if (
                    (preferToSell(maxes.surplusStatus, status) ||
                        (delta.gt(maxes.surplus) && maxes.surplusStatus == status)) &&
                    TradeLib.isEnoughToSell(asset, price_, bal.minus(needed), rules.minTradeVolume)
                ) {
                    trade.sell = asset;
                    trade.sellAmount = bal.minus(needed);
                    trade.sellPrice = price_;

                    maxes.surplusStatus = status;
                    maxes.surplus = delta;
                }
            } else {
                // needed(Bottom): token balance needed at bottom of the basket range
                needed = range.bottom.mul(components.bh.quantity(erc20s[i]), CEIL); // {tok};
                if (bal.lt(needed)) {
                    uint192 amtShort = needed.minus(bal); // {tok}
                    (, uint192 price_) = asset.price(true); // {UoA/tok} allow fallback prices

                    // {UoA} = {tok} * {UoA/tok}
                    uint192 delta = amtShort.mul(price_, CEIL);
                    if (delta.gt(maxes.deficit)) {
                        trade.buy = ICollateral(address(asset));
                        trade.buyAmount = amtShort;
                        trade.buyPrice = price_;

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
            (, uint192 price_) = rsrAsset.price(true); // {UoA/tok} allow fallback prices

            if (TradeLib.isEnoughToSell(rsrAsset, price_, rsrAvailable, rules.minTradeVolume)) {
                trade.sell = rsrAsset;
                trade.sellAmount = rsrAvailable;
                trade.sellPrice = price_;
            }
        }
    }

    /// @param backing {UoA} An amount of backing in UoA terms
    /// @param basketPrice {UoA/BU} The price of a BU in UoA terms, at precise prices
    /// @return shortfall {UoA} The missing re-collateralization in UoA terms
    // Specifically, returns:
    //   sum( shortfall(c, basketTargetHigh / basketPrice) for each erc20 c in the basket)
    //   where shortfall(c, numBUs) == (numBus * bh.quantity(c) - c.balanceOf(trader)) * c.price()
    //         (that is, shortfall(c, numBUs) is the market value of the c that `this` would
    //          need to be given in order to have enough of c to cover `numBUs` BUs)
    // precondition: erc20s contains no duplicates; all basket tokens are in erc20s
    function collateralShortfall(
        ComponentCache memory components,
        IERC20[] memory erc20s,
        uint192 backing,
        uint192 basketPrice
    ) private view returns (uint192 shortfall) {
        assert(basketPrice > 0); // div by zero further down in function

        // accumulate shortfall
        for (uint256 i = 0; i < erc20s.length; ++i) {
            uint192 quantity = components.bh.quantity(erc20s[i]); // {tok/BU}
            if (quantity.eq(FIX_ZERO)) continue; // skip any collateral not needed

            // Cast: if the quantity is nonzero, then it must be collateral
            ICollateral coll = components.reg.toColl(erc20s[i]);

            // {tok} = {UoA} * {tok/BU} / {UoA/BU}
            // needed: quantity of erc20s[i] needed in basketPrice's worth of baskets
            uint192 needed = backing.mulDiv(quantity, basketPrice, CEIL); // {tok}
            // held: quantity of erc20s[i] owned by `this`
            uint192 held = coll.bal(address(components.trader)); // {tok}

            if (held.lt(needed)) {
                (, uint192 price_) = coll.price(true); // allow fallback prices

                // {UoA} = {UoA} + ({tok} - {tok}) * {UoA/tok}
                shortfall = shortfall.plus(needed.minus(held).mul(price_, FLOOR));
            }
        }
    }

    /// Prefer selling assets in this order: DISABLED -> SOUND -> IFFY.
    /// @return If we prefer to sell `status2` over `status1`
    function preferToSell(CollateralStatus status1, CollateralStatus status2)
        private
        pure
        returns (bool)
    {
        // NOTE: If we change the CollaetralStatus enum then this has to change!
        if (status1 == CollateralStatus.DISABLED) return false;
        if (status1 == CollateralStatus.SOUND) return status2 == CollateralStatus.DISABLED;
        return status2 != CollateralStatus.IFFY;
    }
}
