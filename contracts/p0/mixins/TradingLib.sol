// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../../interfaces/IAsset.sol";
import "../../interfaces/IAssetRegistry.sol";
import "../../interfaces/IBackingManager.sol";
import "../../interfaces/IMain.sol";
import "../../libraries/Fixed.sol";

enum SwapVariant {
    CALCULATE_BUY_AMOUNT,
    CALCULATE_SELL_AMOUNT
}

/**
 * @title TradingLibP0
 * @notice P0 trade preparation functions
 *   Users:
 *     - BackingManager
 *     - RTokenAsset
 *
 * Interface:
 *  1. prepareRecollateralizationTrade (external)
 *  2. basketRange (internal)
 */
library TradingLibP0 {
    using FixLib for uint192;
    using TradingLibP0 for TradeInfo;
    using TradingLibP0 for IBackingManager;

    /// @dev One of the TradeRequest amounts will be overwritten depending on the SwapVariant
    /// @param req The TradeRequest
    /// @param pricepoint {1} the percentile price to choose among the lowest and highest possible
    /// @param variant Determines whether the buy amount or sell amount will be overwritten
    function prepareSwap(
        TradeRequest memory req,
        uint192 pricepoint,
        SwapVariant variant
    ) internal view returns (Swap memory s) {
        // Only swap SOUND/Asset <-> SOUND/Asset
        require(
            (!req.sell.isCollateral() ||
                ICollateral(address(req.sell)).status() == CollateralStatus.SOUND) &&
                (!req.buy.isCollateral() ||
                    ICollateral(address(req.buy)).status() == CollateralStatus.SOUND),
            "cannot swap unsound collateral"
        );

        // Only swap when prices are well-defined
        (uint192 sellLow, uint192 sellHigh) = req.sell.price(); // {UoA/sellTok}
        (uint192 buyLow, uint192 buyHigh) = req.buy.price(); // {UoA/buyTok}
        require(sellLow > 0 && sellHigh < FIX_MAX, "bad sell pricing");
        require(buyLow > 0 && buyHigh < FIX_MAX, "bad buy pricing");

        // {buyTok/sellTok} = {UoA/sellTok} / {UoA/buyTok}
        uint192 worstPrice = sellLow.div(buyHigh, FLOOR);
        uint192 bestPrice = sellHigh.div(buyLow, CEIL);

        // {buyTok/sellTok} = {buyTok/sellPrice} + {buyTok/sellPrice} * {1}
        uint192 price = worstPrice + (bestPrice - worstPrice).mul(pricepoint, ROUND);
        s = Swap(req.sell.erc20(), req.buy.erc20(), req.sellAmount, req.minBuyAmount);

        if (variant == SwapVariant.CALCULATE_SELL_AMOUNT) {
            // {buyTok}
            uint192 buyAmount = shiftl_toFix(req.minBuyAmount, -int8(req.buy.erc20Decimals()));

            // {sellTok} = {buyTok} / {buyTok/sellTok}
            s.sellAmount = buyAmount.div(price, CEIL).shiftl_toUint(
                int8(req.sell.erc20Decimals()),
                CEIL
            );
        } else {
            // must be SwapVariant.CALCULATE_BUY_AMOUNT

            // {sellTok}
            uint192 sellAmount = shiftl_toFix(req.sellAmount, -int8(req.sell.erc20Decimals()));

            // {buyTok} = {sellTok} * {buyTok/sellTok}
            s.buyAmount = sellAmount.mul(price, FLOOR).shiftl_toUint(
                int8(req.buy.erc20Decimals()),
                FLOOR
            );
        }
    }

    /// Prepare a trade to sell `trade.sellAmount` that guarantees a reasonable closing price,
    /// without explicitly aiming at a particular quantity to purchase.
    /// @param trade:
    ///   sell != 0, sellAmount >= 0 {sellTok}, sellPrice >= 0 {UoA/sellTok}
    ///   buy != 0, buyAmount (unused) {buyTok}, buyPrice > 0 {UoA/buyTok}
    /// @return notDust True when the trade is larger than the dust amount
    /// @return req The prepared trade request to send to the Broker
    //
    // If notDust is true, then the returned trade request satisfies:
    //   req.sell == trade.sell and req.buy == trade.buy,
    //   req.minBuyAmount * trade.buyPrice ~=
    //        trade.sellAmount * trade.sellPrice * (1-maxTradeSlippage),
    //   req.sellAmount == min(trade.sell.maxTradeSize().toQTok(), trade.sellAmount.toQTok(sell)
    //   1 < req.sellAmount
    //
    // If notDust is false, no trade exists that satisfies those constraints.
    function prepareTradeSell(
        TradeInfo memory trade,
        uint192 minTradeVolume,
        uint192 maxTradeSlippage
    ) internal view returns (bool notDust, TradeRequest memory req) {
        // checked for in RevenueTrader / CollateralizatlionLib
        assert(trade.buyPrice > 0 && trade.buyPrice < FIX_MAX && trade.sellPrice < FIX_MAX);

        (uint192 lotLow, uint192 lotHigh) = trade.sell.lotPrice();

        // Don't sell dust
        if (!isEnoughToSell(trade.sell, trade.sellAmount, lotLow, minTradeVolume)) {
            return (false, req);
        }

        // Cap sell amount
        uint192 maxSell = maxTradeSize(trade.sell, lotHigh); // {sellTok}
        uint192 s = trade.sellAmount > maxSell ? maxSell : trade.sellAmount; // {sellTok}

        // Calculate equivalent buyAmount within [0, FIX_MAX]
        // {buyTok} = {sellTok} * {1} * {UoA/sellTok} / {UoA/buyTok}
        uint192 b = safeMulDivCeil(
            ITrading(address(this)),
            s.mul(FIX_ONE.minus(maxTradeSlippage)),
            trade.sellPrice, // {UoA/sellTok}
            trade.buyPrice // {UoA/buyTok}
        );

        // {*tok} => {q*Tok}
        req.sellAmount = s.shiftl_toUint(int8(trade.sell.erc20Decimals()), FLOOR);
        req.minBuyAmount = b.shiftl_toUint(int8(trade.buy.erc20Decimals()), CEIL);
        req.sell = trade.sell;
        req.buy = trade.buy;
        return (true, req);
    }

    /// Assuming we have `trade.sellAmount` sell tokens available, prepare a trade to cover as
    /// much of our deficit of `trade.buyAmount` buy tokens as possible, given expected trade
    /// slippage and the sell asset's maxTradeVolume().
    /// @param trade:
    ///   sell != 0
    ///   buy != 0
    ///   sellAmount (unused) {sellTok}
    ///   buyAmount >= 0 {buyTok}
    ///   sellPrice > 0 {UoA/sellTok}
    ///   buyPrice > 0 {UoA/buyTok}
    /// @return notDust Whether the prepared trade is large enough to be worth trading
    /// @return req The prepared trade request to send to the Broker
    //
    // Returns prepareTradeSell(trade, rules), where
    //   req.sellAmount = min(trade.sellAmount,
    //                trade.buyAmount * (trade.buyPrice / trade.sellPrice) / (1-maxTradeSlippage))
    //   i.e, the minimum of trade.sellAmount and (a sale amount that, at current prices and
    //   maximum slippage, will yield at least the requested trade.buyAmount)
    //
    // Which means we should get that, if notDust is true, then:
    //   req.sell = sell and req.buy = buy
    //
    //   1 <= req.minBuyAmount <= max(trade.buyAmount, buy.minTradeSize()).toQTok(trade.buy)
    //   1 < req.sellAmount <= min(trade.sellAmount.toQTok(trade.sell),
    //                               sell.maxTradeSize().toQTok(trade.sell))
    //   req.minBuyAmount ~= trade.sellAmount * sellPrice / buyPrice * (1-maxTradeSlippage)
    //
    //   req.sellAmount (and req.minBuyAmount) are maximal satisfying all these conditions
    function prepareTradeToCoverDeficit(
        TradeInfo memory trade,
        uint192 minTradeVolume,
        uint192 maxTradeSlippage
    ) internal view returns (bool notDust, TradeRequest memory req) {
        assert(
            trade.sellPrice > 0 &&
                trade.sellPrice < FIX_MAX &&
                trade.buyPrice > 0 &&
                trade.buyPrice < FIX_MAX
        );

        // Don't buy dust.
        trade.buyAmount = fixMax(trade.buyAmount, minTradeSize(minTradeVolume, trade.buyPrice));

        // {sellTok} = {buyTok} * {UoA/buyTok} / {UoA/sellTok}
        uint192 exactSellAmount = trade.buyAmount.mulDiv(trade.buyPrice, trade.sellPrice, CEIL);
        // exactSellAmount: Amount to sell to buy `deficitAmount` if there's no slippage

        // slippedSellAmount: Amount needed to sell to buy `deficitAmount`, counting slippage
        uint192 slippedSellAmount = exactSellAmount.div(FIX_ONE.minus(maxTradeSlippage), CEIL);

        trade.sellAmount = fixMin(slippedSellAmount, trade.sellAmount); // {sellTok}
        return prepareTradeSell(trade, minTradeVolume, maxTradeSlippage);
    }

    /// Struct purposes:
    ///   1. Configure trading
    ///   2. Stay under stack limit with fewer vars
    ///   3. Cache information such as component addresses to save on gas

    struct TradingContext {
        BasketRange basketsHeld; // {BU}
        // basketsHeld.top is the number of partial baskets units held
        // basketsHeld.bottom is the number of full basket units held

        // Components
        IBackingManager bm;
        IBasketHandler bh;
        IAssetRegistry reg;
        IStRSR stRSR;
        IERC20 rsr;
        IRToken rToken;
        // Gov Vars
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

    /// Select and prepare a trade that moves us closer to capitalization, using the
    /// basket range to avoid overeager/duplicate trading.
    // This is the "main loop" for recollateralization trading:
    // actions:
    //   let range = basketRange(all erc20s)
    //   let trade = nextTradePair(...)
    //   if trade.sell is not a defaulted collateral, prepareTradeToCoverDeficit(...)
    //   otherwise, prepareTradeSell(trade) with a 0 minBuyAmount
    function prepareRecollateralizationTrade(IBackingManager bm, BasketRange memory basketsHeld)
        external
        view
        returns (bool doTrade, TradeRequest memory req)
    {
        // === Prepare cached values ===

        IMain main = bm.main();
        TradingContext memory ctx = TradingContext({
            basketsHeld: basketsHeld,
            bm: bm,
            bh: main.basketHandler(),
            reg: main.assetRegistry(),
            stRSR: main.stRSR(),
            rsr: main.rsr(),
            rToken: main.rToken(),
            minTradeVolume: bm.minTradeVolume(),
            maxTradeSlippage: bm.maxTradeSlippage()
        });
        IERC20[] memory erc20s = ctx.reg.erc20s();

        // ============================

        // Compute a target basket range for trading -  {BU}
        BasketRange memory range = basketRange(ctx, erc20s);

        // Select a pair to trade next, if one exists
        TradeInfo memory trade = nextTradePair(ctx, erc20s, range);

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
            (doTrade, req) = trade.prepareTradeSell(ctx.minTradeVolume, ctx.maxTradeSlippage);
        } else {
            (doTrade, req) = trade.prepareTradeToCoverDeficit(
                ctx.minTradeVolume,
                ctx.maxTradeSlippage
            );
        }

        // At this point doTrade _must_ be true, otherwise nextTradePair assumptions are broken
        assert(doTrade);

        return (doTrade, req);
    }

    // Compute the target basket range
    // Algorithm intuition: Trade conservatively. Quantify uncertainty based on the proportion of
    // token balances requiring trading vs not requiring trading. Decrease uncertainty the largest
    // amount possible with each trade.
    //
    // How do we know this algorithm converges?
    // Assumption: constant prices
    // Any volume traded narrows the BU band. Why:
    //   - We might increase `basketsHeld.bottom` from run-to-run, but will never decrease it
    //   - We might decrease the UoA amount of excess balances beyond `basketsHeld.bottom` from
    //       run-to-run, but will never increase it
    //   - We might decrease the UoA amount of missing balances up-to `basketsHeld.top` from
    //       run-to-run, but will never increase it
    //
    // Preconditions:
    // - ctx is correctly populated with current basketsHeld.bottom + basketsHeld.top
    // - reg contains erc20 + asset arrays in same order and without duplicates
    // Trading Strategy:
    // - We will not aim to hold more than rToken.basketsNeeded() BUs
    // - No double trades: if we buy B in one trade, we won't sell B in another trade
    //       Caveat: Unless the asset we're selling is IFFY/DISABLED
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
    //   where "least baskets purchaseable" involves trading at unfavorable prices,
    //   incurring maxTradeSlippage, and taking up to a minTradeVolume loss due to dust.
    function basketRange(TradingContext memory ctx, IERC20[] memory erc20s)
        internal
        view
        returns (BasketRange memory range)
    {
        (uint192 buPriceLow, uint192 buPriceHigh) = ctx.bh.price(); // {UoA/BU}

        // Cap ctx.basketsHeld.top
        if (ctx.basketsHeld.top > ctx.rToken.basketsNeeded()) {
            ctx.basketsHeld.top = ctx.rToken.basketsNeeded();
        }

        // === (1/3) Calculate contributions from surplus/deficits ===

        // for range.top, anchor to min(ctx.basketsHeld.top, basketsNeeded)
        // for range.bottom, anchor to min(ctx.basketsHeld.bottom, basketsNeeded)

        // a signed delta to be applied to range.top
        int256 deltaTop; // D18{BU} even though this is int256, it is D18
        // not required for range.bottom

        for (uint256 i = 0; i < erc20s.length; ++i) {
            // Exclude RToken balances to avoid double counting value
            if (erc20s[i] == IERC20(address(ctx.rToken))) continue;

            IAsset asset = ctx.reg.toAsset(erc20s[i]);

            uint192 bal = asset.bal(address(ctx.bm)); // {tok}

            // For RSR, include the staking balance
            if (erc20s[i] == ctx.rsr) {
                bal = bal.plus(asset.bal(address(ctx.stRSR)));
            }

            {
                // Skip over dust-balance assets not in the basket
                (uint192 lotLow, ) = asset.lotPrice(); // {UoA/tok}

                // Intentionally include value of IFFY/DISABLED collateral
                if (
                    ctx.bh.quantity(erc20s[i]) == 0 &&
                    !isEnoughToSell(asset, bal, lotLow, ctx.minTradeVolume)
                ) continue;
            }
            (uint192 low, uint192 high) = asset.price(); // {UoA/tok}

            // throughout these sections +/- is same as Fix.plus/Fix.minus and </> is Fix.gt/.lt

            // deltaTop: optimistic case
            // if in deficit relative to ctx.basketsHeld.top: deduct missing baskets
            // if in surplus relative to ctx.basketsHeld.top: add-in surplus baskets
            {
                // {tok} = {tok/BU} * {BU}
                uint192 anchor = ctx.bh.quantity(erc20s[i]).mul(ctx.basketsHeld.top, CEIL);

                if (anchor > bal) {
                    // deficit: deduct optimistic estimate of baskets missing

                    // {BU} = {UoA/tok} * {tok} / {UoA/BU}
                    deltaTop -= int256(uint256(low.mulDiv(anchor - bal, buPriceHigh, FLOOR)));
                    // does not need underflow protection: using low price of asset
                } else {
                    // surplus: add-in optimistic estimate of baskets purchaseable

                    // {BU} = {UoA/tok} * {tok} / {UoA/BU}
                    deltaTop += int256(
                        uint256(ctx.bm.safeMulDivCeil(high, bal - anchor, buPriceLow))
                    );
                    // needs overflow protection: using high price of asset which can be FIX_MAX
                }
            }

            // range.bottom: pessimistic case
            // add-in surplus baskets relative to ctx.basketsHeld.bottom
            {
                // {tok} = {tok/BU} * {BU}
                uint192 anchor = ctx.bh.quantity(erc20s[i]).mul(ctx.basketsHeld.bottom, FLOOR);

                // (1) Sell tokens at low price
                // {UoA} = {UoA/tok} * {tok}
                uint192 val = low.mul(bal - anchor, FLOOR);

                // (2) Lose minTradeVolume to dust (why: auctions can return tokens)
                // Q: Why is this precisely where we should take out minTradeVolume?
                // A: Our use of isEnoughToSell always uses the low price (lotLow, technically),
                //   so min trade volumes are always assesed based on low prices. At this point
                //   in the calculation we have already calculated the UoA amount corresponding to
                //   the excess token balance based on its low price, so we are already set up
                //   to straightforwardly deduct the minTradeVolume before trying to buy BUs.
                val = (val < ctx.minTradeVolume) ? 0 : val - ctx.minTradeVolume;

                // (3) Buy BUs at their high price with the remaining value
                // (4) Assume maximum slippage in trade
                // {BU} = {UoA} * {1} / {UoA/BU}
                range.bottom += val.mulDiv(FIX_ONE.minus(ctx.maxTradeSlippage), buPriceHigh, FLOOR);
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
        range.bottom += ctx.basketsHeld.bottom;
        // reverting on overflow is appropriate here

        // ==== (3/3) Enforce (range.bottom <= range.top <= basketsNeeded) ====

        if (range.top > ctx.rToken.basketsNeeded()) range.top = ctx.rToken.basketsNeeded();
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
        TradingContext memory ctx,
        IERC20[] memory erc20s,
        BasketRange memory range
    ) private view returns (TradeInfo memory trade) {
        MaxSurplusDeficit memory maxes;
        maxes.surplusStatus = CollateralStatus.IFFY; // least-desirable sell status

        // No space on the stack to cache erc20s.length
        for (uint256 i = 0; i < erc20s.length; ++i) {
            if (erc20s[i] == ctx.rsr) continue;

            IAsset asset = ctx.reg.toAsset(erc20s[i]);

            uint192 bal = asset.bal(address(ctx.bm)); // {tok}

            // needed(Top): token balance needed for range.top baskets: quantity(e) * range.top
            // {tok} = {BU} * {tok/BU}
            uint192 needed = range.top.mul(ctx.bh.quantity(erc20s[i]), CEIL); // {tok}
            if (bal.gt(needed)) {
                (uint192 lotLow, ) = asset.lotPrice(); // {UoA/sellTok}

                // by calculating this early we can duck the stack limit but be less gas-efficient
                bool enoughToSell = isEnoughToSell(
                    asset,
                    bal.minus(needed),
                    lotLow,
                    ctx.minTradeVolume
                );

                (uint192 low, uint192 high) = asset.price(); // {UoA/sellTok}

                // Skip worthless assets
                if (high == 0) continue;

                // {UoA} = {sellTok} * {UoA/sellTok}
                uint192 delta = bal.minus(needed).mul(lotLow, FLOOR);

                // status = asset.status() if asset.isCollateral() else SOUND
                CollateralStatus status; // starts SOUND
                if (asset.isCollateral()) status = ICollateral(address(asset)).status();

                // Select the most-in-surplus "best" asset still enough to sell,
                // as defined by a (status, surplusAmt) ordering
                if (isBetterSurplus(maxes, status, delta) && enoughToSell) {
                    trade.sell = asset;
                    trade.sellAmount = bal.minus(needed);
                    trade.sellPrice = low;

                    maxes.surplusStatus = status;
                    maxes.surplus = delta;
                }
            } else {
                // needed(Bottom): token balance needed at bottom of the basket range
                needed = range.bottom.mul(ctx.bh.quantity(erc20s[i]), CEIL); // {buyTok};
                if (bal.lt(needed)) {
                    uint192 amtShort = needed.minus(bal); // {buyTok}
                    (, uint192 high) = asset.price(); // {UoA/buyTok}

                    // {UoA} = {buyTok} * {UoA/buyTok}
                    uint192 delta = amtShort.mul(high, CEIL);

                    // The best asset to buy is whichever asset has the largest deficit
                    if (delta.gt(maxes.deficit)) {
                        trade.buy = ICollateral(address(asset));
                        trade.buyAmount = amtShort;
                        trade.buyPrice = high;

                        maxes.deficit = delta;
                    }
                }
            }
        }

        // Use RSR if needed
        if (address(trade.sell) == address(0) && address(trade.buy) != address(0)) {
            IAsset rsrAsset = ctx.reg.toAsset(ctx.rsr);

            uint192 rsrAvailable = rsrAsset.bal(address(ctx.bm)).plus(
                rsrAsset.bal(address(ctx.stRSR))
            );
            (uint192 low, uint192 high) = rsrAsset.price(); // {UoA/tok}
            (uint192 lotLow, ) = rsrAsset.lotPrice(); // {UoA/sellTok}

            if (high > 0 && isEnoughToSell(rsrAsset, rsrAvailable, lotLow, ctx.minTradeVolume)) {
                trade.sell = rsrAsset;
                trade.sellAmount = rsrAvailable;
                trade.sellPrice = low;
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

    /// @param asset The asset in consideration
    /// @param amt {tok} The number of whole tokens we plan to sell
    /// @param price {UoA/tok} The price to use for sizing
    /// @param minTradeVolume {UoA} The min trade volume, passed in for gas optimization
    /// @return If amt is sufficiently large to be worth selling into our trading platforms
    function isEnoughToSell(
        IAsset asset,
        uint192 amt,
        uint192 price,
        uint192 minTradeVolume
    ) internal view returns (bool) {
        return
            amt.gte(minTradeSize(minTradeVolume, price)) &&
            // Trading platforms often don't allow token quanta trades for rounding reasons
            // {qTok} = {tok} / {tok/qTok}
            amt.shiftl_toUint(int8(asset.erc20Decimals())) > 1;
    }

    /// @return The result of FixLib.mulDiv bounded from above by FIX_MAX in the case of overflow
    function safeMulDivCeil(
        ITrading trader,
        uint192 x,
        uint192 y,
        uint192 z
    ) internal pure returns (uint192) {
        try trader.mulDivCeil(x, y, z) returns (uint192 result) {
            return result;
        } catch Panic(uint256 errorCode) {
            // 0x11: overflow
            // 0x12: div-by-zero
            assert(errorCode == 0x11 || errorCode == 0x12);
        } catch (bytes memory reason) {
            assert(keccak256(reason) == UIntOutofBoundsHash);
        }
        return FIX_MAX;
    }

    // === Private ===

    /// Calculates the minTradeSize for an asset based on the given minTradeVolume and price
    /// @param minTradeVolume {UoA} The min trade volume, passed in for gas optimization
    /// @return {tok} The min trade size for the asset in whole tokens
    function minTradeSize(uint192 minTradeVolume, uint192 price) private pure returns (uint192) {
        // {tok} = {UoA} / {UoA/tok}
        uint192 size = price == 0 ? FIX_MAX : minTradeVolume.div(price, CEIL);
        return size > 0 ? size : 1;
    }

    /// Calculates the maxTradeSize for an asset based on the asset's maxTradeVolume and price
    /// @return {tok} The max trade size for the asset in whole tokens
    function maxTradeSize(IAsset asset, uint192 price) private view returns (uint192) {
        uint192 size = price == 0 ? FIX_MAX : asset.maxTradeVolume().div(price, FLOOR);
        return size > 0 ? size : 1;
    }
}
