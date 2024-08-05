// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../../libraries/Fixed.sol";
import "./TradeLib.sol";

/**
 * @title RecollateralizationLibP1
 * @notice An informal extension of BackingManager that implements the rebalancing logic
 *   Users:
 *     - BackingManager
 *     - RTokenAsset (uses `basketRange()`)
 *
 * Interface:
 *  1. prepareRecollateralizationTrade() (external)
 *  2. basketRange() (internal)
 */
library RecollateralizationLibP1 {
    using FixLib for uint192;
    using TradeLib for TradeInfo;
    using TradeLib for IBackingManager;

    /// Select and prepare a trade that moves us closer to capitalization, using the
    /// basket range to avoid overeager/duplicate trading.
    /// The basket range is the full range of projected outcomes for the rebalancing process.
    // This is the "main loop" for recollateralization trading:
    // actions:
    //   let range = basketRange(...)
    //   let trade = nextTradePair(...)
    //   if trade.sell is not a defaulted collateral, prepareTradeToCoverDeficit(...)
    //   otherwise, prepareTradeSell(...) taking the minBuyAmount as the dependent variable
    function prepareRecollateralizationTrade(TradingContext memory ctx, Registry memory reg)
        external
        view
        returns (
            bool doTrade,
            TradeRequest memory req,
            TradePrices memory prices
        )
    {
        // Compute a target basket range for trading -  {BU}
        // The basket range is the full range of projected outcomes for the rebalancing process
        BasketRange memory range = basketRange(ctx, reg);

        // Select a pair to trade next, if one exists
        TradeInfo memory trade = nextTradePair(ctx, reg, range);

        // Don't trade if no pair is selected
        if (address(trade.sell) == address(0) || address(trade.buy) == address(0)) {
            return (false, req, prices);
        }

        // If we are selling a fully unpriced asset or UNSOUND collateral, do not cover deficit
        // untestable:
        //     sellLow will not be zero, those assets are skipped in nextTradePair
        if (
            trade.prices.sellLow == 0 ||
            (trade.sell.isCollateral() &&
                ICollateral(address(trade.sell)).status() != CollateralStatus.SOUND)
        ) {
            // Emergency case
            // Set minBuyAmount as a function of sellAmount
            (doTrade, req) = trade.prepareTradeSell(ctx.minTradeVolume, ctx.maxTradeSlippage);
        } else {
            // Normal case
            // Set sellAmount as a function of minBuyAmount
            (doTrade, req) = trade.prepareTradeToCoverDeficit(
                ctx.minTradeVolume,
                ctx.maxTradeSlippage
            );
        }

        // At this point doTrade _must_ be true, otherwise nextTradePair assumptions are broken
        assert(doTrade);

        return (doTrade, req, trade.prices);
    }

    // Compute the target basket range
    // Algorithm intuition: Trade conservatively. Quantify uncertainty based on the proportion of
    // token balances requiring trading vs not requiring trading. Seek to decrease uncertainty
    // the largest amount possible with each trade.
    //
    // Algorithm Invariant: every increase of basketsHeld.bottom causes basketsRange().low to
    //  reach a new maximum. Note that basketRange().low may decrease slightly along the way.
    // Assumptions: constant oracle prices; monotonically increasing refPerTok; no supply changes
    //
    // Preconditions:
    // - ctx is correctly populated, with current basketsHeld.bottom + basketsHeld.top
    // - reg contains erc20 + asset + quantities arrays in same order and without duplicates
    // Trading Strategy:
    // - We will not aim to hold more than rToken.basketsNeeded() BUs
    // - No double trades: capital converted from token A to token B should not go to token C
    //       unless the clearing price was outside the expected price range
    // - The best price we might get for a trade is at the high sell price and low buy price
    // - The worst price we might get for a trade is at the low sell price and
    //     the high buy price, multiplied by ( 1 - maxTradeSlippage )
    // - In the worst-case an additional dust balance can be lost, up to minTradeVolume
    // - Given all that, we're aiming to hold as many BUs as possible using the assets we own.
    //
    // More concretely:
    // - range.top = min(rToken.basketsNeeded, basketsHeld.top - least baskets missing
    //                                                                   + most baskets surplus)
    // - range.bottom = min(rToken.basketsNeeded, basketsHeld.bottom + least baskets purchaseable)
    //   where "least baskets purchaseable" involves trading at the worst price,
    //   incurring the full maxTradeSlippage, and taking up to a minTradeVolume loss due to dust.
    function basketRange(TradingContext memory ctx, Registry memory reg)
        internal
        view
        returns (BasketRange memory range)
    {
        // tradesOpen will be 0 when called by prepareRecollateralizationTrade()
        // tradesOpen can be > 0 when called by RTokenAsset.basketRange()

        (uint192 buPriceLow, uint192 buPriceHigh) = ctx.bh.price(false); // {UoA/BU}
        require(buPriceLow != 0 && buPriceHigh != FIX_MAX, "BUs unpriced");

        uint192 basketsNeeded = ctx.rToken.basketsNeeded(); // {BU}

        // Cap ctx.basketsHeld.top
        if (ctx.basketsHeld.top > basketsNeeded) {
            ctx.basketsHeld.top = basketsNeeded;
        }

        // === (1/3) Calculate contributions from surplus/deficits ===

        // for range.top, anchor to min(ctx.basketsHeld.top, basketsNeeded)
        // for range.bottom, anchor to min(ctx.basketsHeld.bottom, basketsNeeded)

        // a signed delta to be applied to range.top
        int256 deltaTop; // D18{BU} even though this is int256, it is D18
        // not required for range.bottom

        // to minimize total operations, range.bottom is calculated from a summed UoA
        uint192 uoaBottom; // {UoA} pessimistic UoA estimate of balances above basketsHeld.bottom

        // (no space on the stack to cache erc20s.length)
        for (uint256 i = 0; i < reg.erc20s.length; ++i) {
            // Exclude RToken balances to avoid double counting value
            if (reg.erc20s[i] == IERC20(address(ctx.rToken))) continue;

            (uint192 low, uint192 high) = reg.assets[i].price(); // {UoA/tok}

            // Skip over dust-balance assets not in the basket
            // Intentionally include value of IFFY/DISABLED collateral
            if (
                ctx.quantities[i] == 0 &&
                !TradeLib.isEnoughToSell(reg.assets[i], ctx.bals[i], low, ctx.minTradeVolume)
            ) {
                continue;
            }

            // throughout these sections +/- is same as Fix.plus/Fix.minus and </> is Fix.gt/.lt

            // deltaTop: optimistic case
            // if in deficit relative to ctx.basketsHeld.top: deduct missing baskets
            // if in surplus relative to ctx.basketsHeld.top: add-in surplus baskets
            {
                // {tok} = {tok/BU} * {BU}
                uint192 anchor = ctx.quantities[i].mul(ctx.basketsHeld.top, CEIL);

                if (anchor > ctx.bals[i]) {
                    // deficit: deduct optimistic estimate of baskets missing

                    // {BU} = {UoA/tok} * {tok} / {UoA/BU}
                    deltaTop -= int256(
                        uint256(low.mulDiv(anchor - ctx.bals[i], buPriceHigh, FLOOR))
                    );
                    // does not need underflow protection: using low price of asset
                } else {
                    // surplus: add-in optimistic estimate of baskets purchaseable

                    //  {BU} = {UoA/tok} * {tok} / {UoA/BU}
                    deltaTop += int256(
                        uint256(high.safeMulDiv(ctx.bals[i] - anchor, buPriceLow, CEIL))
                    );
                }
            }

            // range.bottom: pessimistic case
            // add-in surplus baskets relative to ctx.basketsHeld.bottom
            {
                // {tok} = {tok/BU} * {BU}
                uint192 anchor = ctx.quantities[i].mul(ctx.basketsHeld.bottom, FLOOR);

                // (1) Sum token value at low price
                // {UoA} = {UoA/tok} * {tok}
                uint192 val = low.mul(ctx.bals[i] - anchor, FLOOR);

                // (2) Lose minTradeVolume to dust (why: auctions can return tokens)
                // Q: Why is this precisely where we should take out minTradeVolume?
                // A: Our use of isEnoughToSell always uses the low price,
                //   so min trade volumes are always assessed based on low prices. At this point
                //   in the calculation we have already calculated the UoA amount corresponding to
                //   the excess token balance based on its low price, so we are already set up
                //   to straightforwardly deduct the minTradeVolume before trying to buy BUs.
                uoaBottom += (val < ctx.minTradeVolume) ? 0 : val - ctx.minTradeVolume;
            }
        }

        // ==== (2/3) Add-in ctx.*BasketsHeld safely ====

        // range.top
        if (deltaTop < 0) {
            range.top = ctx.basketsHeld.top - _safeWrap(uint256(-deltaTop));
            // reverting on underflow is appropriate here
        } else {
            // guard against overflow; > is same as Fix.gt
            if (uint256(deltaTop) + ctx.basketsHeld.top > FIX_MAX) range.top = FIX_MAX;
            else range.top = ctx.basketsHeld.top + _safeWrap(uint256(deltaTop));
        }

        // range.bottom
        // (3) Buy BUs at their high price with the remaining value
        // (4) Assume maximum slippage in trade
        // {BU} = {UoA} * {1} / {UoA/BU}
        range.bottom =
            ctx.basketsHeld.bottom +
            uoaBottom.mulDiv(FIX_ONE.minus(ctx.maxTradeSlippage), buPriceHigh, FLOOR);
        // reverting on overflow is appropriate here

        // ==== (3/3) Enforce (range.bottom <= range.top <= basketsNeeded) ====

        if (range.top > basketsNeeded) range.top = basketsNeeded;
        if (range.bottom > range.top) range.bottom = range.top;
    }

    // ===========================================================================================

    // === Private ===

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
    ///   prices.sellLow {UoA/sellTok} The worst-case price of the sell token on secondary markets
    ///   prices.sellHigh {UoA/sellTok} The best-case price of the sell token on secondary markets
    ///   prices.buyLow {UoA/buyTok} The best-case price of the buy token on secondary markets
    ///   prices.buyHigh {UoA/buyTok} The worst-case price of the buy token on secondary markets
    ///
    // For each asset e:
    //   If bal(e) > (quantity(e) * range.top), then e is in surplus by the difference
    //   If bal(e) < (quantity(e) * range.bottom), then e is in deficit by the difference
    //
    // First, ignoring RSR:
    //   `trade.sell` is the token from erc20s with the greatest surplus value (in UoA),
    //   and sellAmount is the quantity of that token that it's in surplus (in qTok).
    //   if `trade.sell` == 0, then no token is in surplus by at least minTradeSize,
    //        and `trade.sellAmount` and `trade.sellLow` / `trade.sellHigh are unset.
    //
    //   `trade.buy` is the token from erc20s with the greatest deficit value (in UoA),
    //   and buyAmount is the quantity of that token that it's in deficit (in qTok).
    //   if `trade.buy` == 0, then no token is in deficit at all,
    //        and `trade.buyAmount` and `trade.buyLow` / `trade.buyHigh` are unset.
    //
    // Then, just if we have a buy asset and no sell asset, consider selling available RSR.
    //
    // Prefer selling assets in this order: DISABLED -> SOUND -> IFFY.
    // Sell IFFY last because it may recover value in the future.
    // All collateral in the basket have already been guaranteed to be SOUND by upstream checks.
    // Warning: If the trading algorithm is changed to trade unpriced (0, FIX_MAX) assets it can
    //          result in losses in GnosisTrade. Unpriced assets should not be sold in rebalancing.
    function nextTradePair(
        TradingContext memory ctx,
        Registry memory reg,
        BasketRange memory range
    ) private view returns (TradeInfo memory trade) {
        // assert(tradesOpen == 0); // guaranteed by BackingManager.rebalance()

        MaxSurplusDeficit memory maxes;
        maxes.surplusStatus = CollateralStatus.IFFY; // least-desirable sell status

        uint256 rsrIndex = reg.erc20s.length; // invalid index, to-start

        // Iterate over non-RSR/non-RToken assets
        // (no space on the stack to cache erc20s.length)
        for (uint256 i = 0; i < reg.erc20s.length; ++i) {
            if (address(reg.erc20s[i]) == address(ctx.rToken)) continue;
            else if (reg.erc20s[i] == ctx.rsr) {
                rsrIndex = i;
                continue;
            }

            // {tok} = {BU} * {tok/BU}
            // needed(Top): token balance needed for range.top baskets: quantity(e) * range.top
            uint192 needed = range.top.mul(ctx.quantities[i], CEIL); // {tok}

            if (ctx.bals[i].gt(needed)) {
                (uint192 low, uint192 high) = reg.assets[i].price(); // {UoA/sellTok}

                if (high == 0) continue; // skip over worthless assets

                // {UoA} = {sellTok} * {UoA/sellTok}
                uint192 delta = ctx.bals[i].minus(needed).mul(low, FLOOR);

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
                        ctx.bals[i].minus(needed),
                        low,
                        ctx.minTradeVolume
                    )
                ) {
                    trade.sell = reg.assets[i];
                    trade.sellAmount = ctx.bals[i].minus(needed);
                    trade.prices.sellLow = low;
                    trade.prices.sellHigh = high;

                    maxes.surplusStatus = status;
                    maxes.surplus = delta;
                }
            } else {
                // needed(Bottom): token balance needed at bottom of the basket range
                needed = range.bottom.mul(ctx.quantities[i], CEIL); // {buyTok};

                if (ctx.bals[i].lt(needed)) {
                    uint192 amtShort = needed.minus(ctx.bals[i]); // {buyTok}
                    (uint192 low, uint192 high) = reg.assets[i].price(); // {UoA/buyTok}

                    // {UoA} = {buyTok} * {UoA/buyTok}
                    uint192 delta = amtShort.mul(high, CEIL);

                    // The best asset to buy is whichever asset has the largest deficit
                    if (delta.gt(maxes.deficit)) {
                        trade.buy = reg.assets[i];
                        trade.buyAmount = amtShort;
                        trade.prices.buyLow = low;
                        trade.prices.buyHigh = high;

                        maxes.deficit = delta;
                    }
                }
            }
        }

        // Use RSR if needed
        if (address(trade.sell) == address(0) && address(trade.buy) != address(0)) {
            (uint192 low, uint192 high) = reg.assets[rsrIndex].price(); // {UoA/RSR}

            // if rsr does not have a registered asset the below array accesses will revert
            if (
                high != 0 &&
                TradeLib.isEnoughToSell(
                    reg.assets[rsrIndex],
                    ctx.bals[rsrIndex],
                    low,
                    ctx.minTradeVolume
                )
            ) {
                trade.sell = reg.assets[rsrIndex];
                trade.sellAmount = ctx.bals[rsrIndex];
                trade.prices.sellLow = low;
                trade.prices.sellHigh = high;
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
