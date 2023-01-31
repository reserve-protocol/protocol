// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../../interfaces/IAsset.sol";
import "../../interfaces/IAssetRegistry.sol";
import "../../interfaces/IBackingManager.sol";
import "../../interfaces/IMain.sol";
import "../../libraries/Fixed.sol";

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
        uint192 basketsHeld; // {BU}
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
    function prepareRecollateralizationTrade(IBackingManager bm, uint192 basketsHeld)
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

        // Compute basket range -  {BU}
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

    // Used to avoid stack-too-deep errors in basketRange
    struct BasketRange {
        uint192 top; // {BU}
        uint192 bottom; // {BU}
    }

    // It's a precondition for all the below helpers that their `erc20s` argument contains at
    // least all basket collateral, plus any registered assets for which the BackingManager has a
    // nonzero balance.

    // This function returns a "plausible range of BUs" assuming that the trading process follows
    //     the following rules:
    //
    // - We will not aim to hold more than rToken.basketsNeeded() BUs
    // - No double trades: if we buy B in one trade, we won't sell B in another trade
    //       Caveat: Unless the asset we're selling is IFFY/DISABLED
    // - No trading the basketsHeld token balances
    // - The best price we might get for a trade is at the high sell price and low buy price
    // - The worst price we might get for a trade is at the low sell price and
    //     the high buy price, multiplied by ( 1 - maxTradeSlippage )
    // - An additional dust balance can be lost, up to minTradeVolume
    // - Given all that, we're aiming to hold as many BUs as possible using the assets we own.
    //
    // Given these assumptions, the following hold:
    //
    // range.top = min(rToken.basketsNeeded, basketsHeld + most baskets possible with excess)
    // range.bottom = min(rToken.basketsNeeded, basketsHeld + least baskets possible with excess)
    //   where "least baskets possible" involves trading at low/high prices,
    //   incurring maxTradeSlippage, and taking up to a minTradeVolume loss.
    function basketRange(TradingContext memory ctx, IERC20[] memory erc20s)
        internal
        view
        returns (BasketRange memory range)
    {
        (uint192 basketPriceLow, uint192 basketPriceHigh) = ctx.bh.price(); // {UoA/BU}

        // === (1/2) Contribution from held baskets ===

        range.top = ctx.basketsHeld;
        range.bottom = ctx.basketsHeld;

        // === (2/2) Contribution from baskets-to-be-bought ===

        for (uint256 i = 0; i < erc20s.length; i++) {
            // Exclude RToken balances to avoid double counting value
            if (erc20s[i] == IERC20(address(ctx.rToken))) continue;

            IAsset asset = ctx.reg.toAsset(erc20s[i]);

            uint192 bal = asset.bal(address(ctx.bm)); // {tok}

            // For RSR, include the staking balance
            if (erc20s[i] == ctx.rsr) {
                bal = bal.plus(asset.bal(address(ctx.stRSR)));
            }

            // Ignore dust amounts for assets not in the basket; their value is inaccessible
            // {tok} = {tok/BU} * {BU}
            uint192 inBasket = ctx.bh.quantity(erc20s[i]).mul(ctx.basketsHeld, FLOOR);
            if (bal < inBasket) inBasket = bal; // not sure if needed

            // Skip over dust-balance assets not in the basket
            {
                (uint192 lotLow, ) = asset.lotPrice(); // {UoA/tok}

                // Intentionally include value of IFFY/DISABLED collateral
                if (
                    ctx.bh.quantity(erc20s[i]) == 0 &&
                    !isEnoughToSell(asset, bal, lotLow, ctx.minTradeVolume)
                ) continue;
            }

            (uint192 low, uint192 high) = asset.price(); // {UoA/tok}

            assert(high != FIX_MAX || inBasket == 0); // collateral in the basket must be priced

            // throughout this section +/- is same as Fix.plus/Fix.minus

            // range.top: contribution from balance beyond basketsHeld
            {
                // pretend we sell the token at its high price and buy BUs at their low price
                // needs overflow protection: unpriced asset with price [0, FIX_MAX] can overflow
                // {BU} = {UoA/tok} * {tok} / {UoA/BU}
                uint192 b = ctx.bm.safeMulDivCeil(high, bal - inBasket, basketPriceLow);
                if (uint256(range.top) + b >= FIX_MAX) range.top = FIX_MAX;
                else range.top += b;
            }

            // range.bottom: contribution from balance beyond basketsHeld
            {
                // pretend we sell the token at its low price and buy BUs at their high price
                // {UoA} = {UoA/tok} * {tok}
                uint192 b = low.mul(bal - inBasket, FLOOR);

                // Account for potential dust loss
                b = (b < ctx.minTradeVolume) ? 0 : b - ctx.minTradeVolume;

                // Then assume we take maxTradeSlippage loss
                // {BU} = {UoA} * {1} / {UoA/BU}
                range.bottom += b.mulDiv(
                    FIX_ONE.minus(ctx.maxTradeSlippage),
                    basketPriceHigh,
                    FLOOR
                );
            }
        }

        // ==== Cap range ====

        uint192 basketsNeeded = ctx.rToken.basketsNeeded();
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
