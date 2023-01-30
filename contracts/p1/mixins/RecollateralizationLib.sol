// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../../interfaces/IAsset.sol";
import "../../interfaces/IAssetRegistry.sol";
import "../../interfaces/IBackingManager.sol";
import "../../libraries/Fixed.sol";
import "./TradeLib.sol";

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
    //   otherwise, prepareTradeSell(...) with a 0 minBuyAmount
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
        Registry memory reg = ctx.reg.getRegistry();

        // ============================

        // Compute basket range -  {BU}
        BasketRange memory range = basketRange(ctx, reg);

        // Select a pair to trade next, if one exists
        TradeInfo memory trade = nextTradePair(ctx, reg, range);

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
        uint192 bottom; // {BU}
        uint192 top; // {BU}
    }

    // It's a precondition for all below internal helpers that their `reg.erc20s` argument contains at
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
    // range.top = min(rToken.basketsNeeded, totalAssetValue(erc20s).top / basket.price().bottom)
    //   because (totalAssetValue(erc20s).top / basket.price().bottom) is how many BUs we can hold
    //   given "best plausible" prices, and we shouldn't hold more than rToken(bm).basketsNeeded
    //
    // range.bottom = max(0, min(lowBUs, range.top)), where:
    //   lowBUs = (assetsLow - maxTradeSlippage * buShortfall(range.top)) / basket.price().top
    //     is the number of BUs that we are *sure* we have the assets to collateralize, and
    //   buShortfall(range.top) = the total value of the assets we'd need to buy in order
    //     in order to fully collateralize `range.top` BUs,
    //
    function basketRange(TradingContext memory ctx, Registry memory reg)
        internal
        view
        returns (BasketRange memory range)
    {
        (uint192 basketPriceLow, uint192 basketPriceHigh) = ctx.bh.price(); // {UoA/BU}

        // {BU} = {UoA} / {UoA/BU}
        uint192 dust = ctx.minTradeVolume.div(basketPriceLow, CEIL);

        // === (1/2) Contribution from held baskets ===

        range.top = ctx.basketsHeld;
        range.bottom = ctx.basketsHeld;

        // === (2/2) Contribution from baskets-to-be-bought ===

        for (uint256 i = 0; i < reg.erc20s.length; ++i) {
            // Exclude RToken balances to avoid double counting value
            if (reg.erc20s[i] == IERC20(address(ctx.rToken))) continue;

            uint192 bal = reg.assets[i].bal(address(ctx.bm)); // {tok}

            // For RSR, include the staking balance
            if (reg.erc20s[i] == ctx.rsr) {
                bal = bal.plus(reg.assets[i].bal(address(ctx.stRSR)));
            }

            // Ignore dust amounts for assets not in the basket; their value is inaccessible
            // {tok} = {tok/BU} * {BU}
            uint192 inBasket = ctx.bh.quantity(reg.erc20s[i]).mul(ctx.basketsHeld, FLOOR);
            if (bal < inBasket) inBasket = bal; // not sure if needed

            // Skip over dust-balance assets not in the basket
            {
                (uint192 lotLow, ) = reg.assets[i].lotPrice(); // {UoA/tok}

                // Intentionally include value of IFFY/DISABLED collateral
                if (
                    inBasket == 0 &&
                    !TradeLib.isEnoughToSell(reg.assets[i], bal, lotLow, ctx.minTradeVolume)
                ) continue;
            }

            (uint192 low, uint192 high) = reg.assets[i].price(); // {UoA/tok}

            assert(high != FIX_MAX || inBasket == 0); // collateral in the basket must be priced

            // throughout this section +/- is same as Fix.plus/Fix.minus

            // range.top: contribution from balance beyond basketsHeld
            {
                // sell at high and buy at low
                // needs overflow protection: unpriced asset with price [0, FIX_MAX] can overflow
                // {BU} = {UoA/tok} * {tok} / {UoA/BU}
                uint192 b = ctx.bm.safeMulDivCeil(high, bal - inBasket, basketPriceLow);
                if (uint256(range.top) + b >= FIX_MAX) range.top = FIX_MAX;
                else range.top += b;
            }

            // range.bottom: contribution from balance beyond basketsHeld
            {
                // sell at low and buy at high
                // also assume we take maxTradeSlippage loss
                // {BU} = {UoA/tok} * {tok} / {UoA/BU} * {1}
                uint192 b = low.mul(bal - inBasket, FLOOR).div(basketPriceHigh).mul(
                    FIX_ONE.minus(ctx.maxTradeSlippage),
                    FLOOR
                );
                // TODO maybe another maxTradeSlippage factor should be in here?

                // Account for potential dust loss
                b = (b < dust) ? 0 : b - dust;
                range.bottom += b;
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
        Registry memory reg,
        BasketRange memory range
    ) private view returns (TradeInfo memory trade) {
        MaxSurplusDeficit memory maxes;
        maxes.surplusStatus = CollateralStatus.IFFY; // least-desirable sell status

        // No space on the stack to cache erc20s.length
        for (uint256 i = 0; i < reg.erc20s.length; ++i) {
            if (reg.erc20s[i] == ctx.rsr) continue;

            uint192 bal = reg.assets[i].bal(address(ctx.bm)); // {tok}

            // {tok} = {BU} * {tok/BU}
            // needed(Top): token balance needed for range.top baskets: quantity(e) * range.top
            uint192 needed = range.top.mul(ctx.bh.quantity(reg.erc20s[i]), CEIL); // {tok}
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
                        ctx.minTradeVolume
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
                needed = range.bottom.mul(ctx.bh.quantity(reg.erc20s[i]), CEIL); // {buyTok};
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
            IAsset rsrAsset = ctx.reg.toAsset(ctx.rsr);

            uint192 rsrAvailable = rsrAsset.bal(address(ctx.bm)).plus(
                rsrAsset.bal(address(ctx.stRSR))
            );
            (uint192 low, uint192 high) = rsrAsset.price(); // {UoA/tok}
            (uint192 lotLow, ) = rsrAsset.lotPrice(); // {UoA/tok}

            if (
                high > 0 &&
                TradeLib.isEnoughToSell(rsrAsset, rsrAvailable, lotLow, ctx.minTradeVolume)
            ) {
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
}
