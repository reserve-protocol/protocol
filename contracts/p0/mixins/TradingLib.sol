// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/interfaces/IAsset.sol";
import "contracts/interfaces/IAssetRegistry.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/interfaces/ITrading.sol";
import "contracts/libraries/Fixed.sol";

/**
 * @title TradingLibP0
 * @notice An informal extension of the Trading mixin that provides trade preparation views
 * @dev The caller must implement the ITrading interface!
 *
 * External-facing interface:
 *  1. prepareTradeSell
 *  2. prepareRecollateralizationTrade
 */
library TradingLibP0 {
    using FixLib for uint192;

    /// Prepare a trade to sell `sellAmount` that guarantees a reasonable closing price,
    /// without explicitly aiming at a particular quantity to purchase.
    /// @param sellAmount {sellTok}
    /// @param sellPrice {UoA/sellTok}
    /// @param buyPrice {UoA/buyTok}
    /// @return notDust True when the trade is larger than the dust amount
    /// @return trade The prepared trade
    // Recall: struct TradeRequest is {IAsset sell, IAsset buy, uint sellAmount, uint minBuyAmount}
    //
    // If notDust is true, then the returned trade satisfies:
    //   trade.sell == sell and trade.buy == buy,
    //   trade.minBuyAmount ~=
    //        trade.sellAmount * sell.strictPrice() / buy.strictPrice() * (1-maxTradeSlippage),
    //   trade.sellAmount <= sell.maxTradeSize().toQTok(sell)
    //   1 < trade.sellAmount
    //   and trade.sellAmount is maximal such that trade.sellAmount <= sellAmount.toQTok(sell)
    //
    // If notDust is false, no trade exists that satisfies those constraints.
    function prepareTradeSell(
        ITrading trader,
        IAsset sell,
        IAsset buy,
        uint192 sellAmount,
        uint192 sellPrice,
        uint192 buyPrice
    ) public view returns (bool notDust, TradeRequest memory trade) {
        assert(buyPrice > 0); // checked for in RevenueTrader / prepareRecollateralizationTrade

        trade.sell = sell;
        trade.buy = buy;

        // Don't sell dust
        if (!isEnoughToSell(sell, sellAmount, trader.minTradeVolume())) return (false, trade);

        // {sellTok}
        uint192 s = fixMin(sellAmount, maxTradeSize(sell)); // use sell.price(true) indirectly

        // {qSellTok}
        trade.sellAmount = s.shiftl_toUint(int8(sell.erc20Decimals()), FLOOR);

        // {buyTok} = {sellTok} * {UoA/sellTok} / {UoA/buyTok}
        uint192 b = s.mul(FIX_ONE.minus(trader.maxTradeSlippage())).mulDiv(
            sellPrice,
            buyPrice,
            CEIL
        );
        trade.minBuyAmount = b.shiftl_toUint(int8(buy.erc20Decimals()), CEIL);

        return (true, trade);
    }

    // Used to avoid stack-too-deep errors
    struct BasketRange {
        uint192 top; // {BU}
        uint192 bottom; // {BU}
    }

    /// Select and prepare a trade that moves us closer to capitalization, using the
    /// basket range to avoid overeager/duplicate trading.
    // This is the "main loop" for recollateralization trading:
    // actions:
    //   let range = basketRange(all erc20s)
    //   let (surplus, deficit, amts...) = nextTradePair(all erc20s, range)
    //   if surplus.strictPrice() is reliable, prepareTradeToCoverDeficit(surplus, deficit, amts...)
    //   otherwise, prepareTradeSell(surplus, deficit, surplusAmt) with a 0 minBuyAmount
    function prepareRecollateralizationTrade(ITrading trader)
        external
        view
        returns (bool doTrade, TradeRequest memory req)
    {
        IAssetRegistry assetRegistry_ = trader.main().assetRegistry();
        IERC20[] memory erc20s = assetRegistry_.erc20s();

        // Compute basket range
        BasketRange memory range = basketRange(trader, erc20s); // {BU}

        // Determine the largest surplus and largest deficit relative to the basket range
        (
            IAsset surplus,
            ICollateral deficit,
            uint192 surplusAmount,
            uint192 deficitAmount
        ) = nextTradePair(trader, erc20s, range);

        if (address(surplus) == address(0) || address(deficit) == address(0)) return (false, req);

        uint192 sellPrice = surplus.strictPrice(); // {UoA/tok}
        uint192 buyPrice = deficit.strictPrice(); // {UoA/tok}
        assert(buyPrice > 0);

        // If we cannot trust surplus.strictPrice(), eliminate the minBuyAmount requirement

        if (
            surplus.isCollateral() &&
            assetRegistry_.toColl(surplus.erc20()).status() != CollateralStatus.SOUND
        ) {
            (doTrade, req) = prepareTradeSell(
                trader,
                surplus,
                deficit,
                surplusAmount,
                sellPrice,
                buyPrice
            );
            req.minBuyAmount = 0;
        } else {
            (doTrade, req) = prepareTradeToCoverDeficit(
                trader,
                surplus,
                deficit,
                surplusAmount,
                deficitAmount,
                sellPrice,
                buyPrice
            );
        }

        // At this point doTrade _must_ be true, otherwise nextTradePair assumptions are broken
        assert(doTrade);

        return (doTrade, req);
    }

    // ==== End of external interface; Begin private helpers ===
    /// The plausible range of BUs that the BackingManager will own after recollateralization.
    /// @param erc20s Assets this computation presumes may be traded to raise funds.
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
    function basketRange(ITrading trader, IERC20[] memory erc20s)
        internal
        view
        returns (BasketRange memory range)
    {
        // basketPrice: The current UoA value of one basket.
        (, uint192 basketPrice) = basket(trader).price(false); // basket collateral is SOUND

        // assetsHigh: The most value we could get from the assets in erc20,
        //             assuming frictionless trades at currently-estimated prices.
        // assetsLow: The least value we might get from the assets in erc20,
        //            assuming frictionless trades, zero value from unreliable prices, and
        //            dustAmount of assets left in each Asset.
        (uint192 assetsHigh, uint192 assetsLow) = totalAssetValue(trader, erc20s); // {UoA}

        // {UoA}, Optimistic estimate of the value of our basket units at the end of this
        //   recollateralization process.
        uint192 basketTargetHigh = fixMin(
            assetsHigh,
            rToken(trader).basketsNeeded().mul(basketPrice)
        );

        // {UoA}, Total value of collateral in shortfall of `basketTargetHigh`. Specifically:
        //   sum( shortfall(c, basketTargetHigh / basketPrice) for each erc20 c in the basket)
        //   where shortfall(c, BUs) == (BUs * bh.quantity(c) - c.balanceOf(trader)) * c.price()
        //         (that is, shortfall(c, BUs) is the market value of the c that `this` would
        //          need to be given in order to have enough of c to cover `BUs` BUs)
        // {UoA}
        uint192 shortfall = collateralShortfall(trader, erc20s, basketTargetHigh, basketPrice);

        // ==== Further adjust the low backing estimate downwards to account for trading frictions

        // {UoA}, Total value of the slippage we'd see if we made `shortfall` trades with
        //     slippage `maxTradeSlippage()`
        uint192 shortfallSlippage = trader.maxTradeSlippage().mul(shortfall);

        // {UoA}, Pessimistic estimate of the value of our basket units at the end of this
        //   recollateralization process.
        uint192 basketTargetLow = assetsLow.gt(shortfallSlippage)
            ? fixMin(assetsLow.minus(shortfallSlippage), basketTargetHigh)
            : 0;

        // {BU} = {UoA} / {BU/UoA}
        range.top = basketTargetHigh.div(basketPrice, CEIL);
        range.bottom = basketTargetLow.div(basketPrice, CEIL);
    }

    /// Total value of the erc20s under management by BackingManager
    /// This may include BackingManager's balances _and_ staked RSR hold by stRSR
    /// @param erc20s tokens to consider "under management" by BackingManager in this computation
    /// @return assetsHigh {UoA} The high estimate of the total value of assets under management
    /// @return assetsLow {UoA} The low estimate of the total value of assets under management

    // preconditions:
    //   `this` is backingManager
    //   erc20s has no duplicates
    // checks:
    //   for e in erc20s, e has a registered asset in the assetRegistry
    // return values:
    // assetsHigh: The most value we could get from the assets in erc20,
    //             assuming frictionless trades at currently-estimated prices.
    // assetsLow: The least value we might get from the assets in erc20,
    //            assuming frictionless trades, zero value from unreliable prices, and
    //            dustAmount of assets left in each Asset.
    function totalAssetValue(ITrading trader, IERC20[] memory erc20s)
        private
        view
        returns (uint192 assetsHigh, uint192 assetsLow)
    {
        // The low estimate is lower than the high estimate due to:
        // - Discounting unsound collateral
        // - Discounting dust amounts for collateral in the basket + non-dust assets

        IERC20 rsrERC20 = rsr(trader);
        IERC20 rToken_ = IERC20(address(rToken(trader)));
        uint192 minTradeVolume_ = trader.minTradeVolume(); // {UoA}

        IBasketHandler bh = basket(trader);
        uint192 potentialDustLoss; // {UoA}

        // Accumulate:
        // - assetsHigh: sum(bal(e)*price(e) for e ... )
        // - potentialDustLoss: sum(minTradeSize(e) for e ... )
        // - assetsLow: sum(bal(e)*price(e) for e ... if e.status() == SOUND or e is just an Asset)
        for (uint256 i = 0; i < erc20s.length; ++i) {
            // Exclude RToken balances, or else we double count
            if (erc20s[i] == rToken_) continue;

            IAsset asset = assetRegistry(trader).toAsset(erc20s[i]);
            uint192 bal = asset.bal(address(trader));

            // For RSR, include the staking balance
            if (erc20s[i] == rsrERC20) bal = bal.plus(asset.bal(address(stRSR(trader))));

            // Ignore dust amounts for assets not in the basket; their value is inaccessible
            bool inBasket = bh.quantity(erc20s[i]).gt(FIX_ZERO);
            if (!inBasket && !isEnoughToSell(asset, bal, minTradeVolume_)) {
                continue;
            }

            (bool isFallback, uint192 p) = asset.price(true); // {UoA}

            // {UoA} = {UoA} + {UoA/tok} * {tok}
            uint192 val = p.mul(bal, FLOOR);

            // Consider all managed assets at face-value prices
            assetsHigh = assetsHigh.plus(val);

            // Accumulate potential losses to dust
            potentialDustLoss = potentialDustLoss.plus(minTradeVolume_);

            // Consider only reliable sources of value for the assetsLow estimate
            if (!isFallback) {
                assetsLow = assetsLow.plus(val);
            }
        }

        // Account for all the places dust could get stuck
        // assetsLow' = max(assetsLow-potentialDustLoss, 0)
        assetsLow = assetsLow.gt(potentialDustLoss) ? assetsLow.minus(potentialDustLoss) : FIX_ZERO;
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
        ITrading trader,
        IERC20[] memory erc20s,
        uint192 backing,
        uint192 basketPrice
    ) private view returns (uint192 shortfall) {
        assert(basketPrice > 0);
        IBasketHandler bh = basket(trader);
        IAssetRegistry assetRegistry_ = assetRegistry(trader);

        // accumulate shortfall
        for (uint256 i = 0; i < erc20s.length; ++i) {
            uint192 quantity = bh.quantity(erc20s[i]); // {tok/BU}
            if (quantity.eq(FIX_ZERO)) continue; // skip any collateral not needed

            // Cast: if the quantity is nonzero, then it must be collateral
            ICollateral coll = assetRegistry_.toColl(erc20s[i]);

            // {tok} = {UoA} * {tok/BU} / {UoA/BU}
            // needed: quantity of erc20s[i] needed in basketPrice's worth of baskets
            uint192 needed = backing.mulDiv(quantity, basketPrice, CEIL); // {tok}
            // held: quantity of erc20s[i] owned by `this`
            uint192 held = coll.bal(address(trader)); // {tok}

            if (held.lt(needed)) {
                (, uint192 price_) = coll.price(true);

                // {UoA} = {UoA} + ({tok} - {tok}) * {UoA/tok}
                shortfall = shortfall.plus(needed.minus(held).mul(price_, FLOOR));
            }
        }
    }

    // Used in memory in `nextTradePair` to duck the stack limit
    struct MaxSurplusDeficit {
        CollateralStatus surplusStatus; // starts SOUND
        uint192 surplus; // {UoA}
        uint192 deficit; // {UoA}
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

    // Choose next sell/buy pair to trade, with reference to the basket range
    // Exclude dust amounts for surplus
    /// @return surplus Surplus asset OR address(0)
    /// @return deficit Deficit collateral OR address(0)
    /// @return surplusAmt {sellTok} Surplus amount (whole tokens)
    /// @return deficitAmt {buyTok} Deficit amount (whole tokens)
    // Defining "surplus" and "deficit":
    // If bal(e) > (quantity(e) * range.top), then e is in surplus by the difference
    // If bal(e) < (quantity(e) * range.bottom), then e is in deficit by the difference
    //
    // First, ignoring RSR:
    //   `surplus` is the token from erc20s with the greatest surplus value (in UoA),
    //   and surplusAmt is the quantity of that token that it's in surplus (in qTok).
    //   if `surplus` == 0, then no token is in surplus by at least minTradeSize and surplusAmt == 0
    //
    //   `deficit` is the token from erc20s with the greatest deficit value (in UoA),
    //   and deficitAmt is the quantity of that token that it's in deficit (in qTok).
    //   if `deficit` == 0, then no token is in deficit at all, and deficitAmt == 0
    //
    // Then, just if we have deficit and no surplus, consider treating available RSR as surplus.
    //
    // Prefer selling assets in this order: DISABLED -> SOUND -> IFFY.
    function nextTradePair(
        ITrading trader,
        IERC20[] memory erc20s,
        BasketRange memory range
    )
        private
        view
        returns (
            IAsset surplus,
            ICollateral deficit,
            uint192 surplusAmt,
            uint192 deficitAmt
        )
    {
        MaxSurplusDeficit memory maxes;
        maxes.surplusStatus = CollateralStatus.IFFY; // least-desirable sell status
        uint192 minTradeVolume_ = trader.minTradeVolume();

        for (uint256 i = 0; i < erc20s.length; ++i) {
            if (erc20s[i] == rsr(trader)) continue;

            IAsset asset = assetRegistry(trader).toAsset(erc20s[i]);

            (, uint192 price_) = asset.price(true); // {UoA/tok} allow fallback prices
            uint192 bal = asset.bal(address(trader)); // {tok}

            // {tok} = {BU} * {tok/BU}
            // needed(Top): token balance needed for range.top baskets: quantity(e) * range.top
            uint192 needed = range.top.mul(basket(trader).quantity(erc20s[i]), CEIL); // {tok}

            if (bal.gt(needed)) {
                uint192 amtExtra = bal.minus(needed); // {tok}

                // {UoA} = {tok} * {UoA/tok}
                uint192 delta = amtExtra.mul(price_, FLOOR);

                CollateralStatus status;
                if (asset.isCollateral()) status = ICollateral(address(asset)).status();

                // Select the most-in-surplus "best" asset, as defined by (status, max surplusAmt)
                if (
                    (preferToSell(maxes.surplusStatus, status) ||
                        (delta.gt(maxes.surplus) && maxes.surplusStatus == status)) &&
                    isEnoughToSell(asset, amtExtra, minTradeVolume_)
                ) {
                    surplus = asset;
                    surplusAmt = amtExtra;
                    maxes.surplusStatus = status;
                    maxes.surplus = delta;
                }
            } else {
                // needed(Bottom): token balance needed at bottom of the basket range
                needed = range.bottom.mul(basket(trader).quantity(erc20s[i]), CEIL); // {tok};
                if (bal.lt(needed)) {
                    uint192 amtShort = needed.minus(bal); // {tok}

                    // {UoA} = {tok} * {UoA/tok}
                    uint192 delta = amtShort.mul(price_, CEIL);
                    if (delta.gt(maxes.deficit)) {
                        deficit = ICollateral(address(asset));
                        deficitAmt = amtShort;
                        maxes.deficit = delta;
                    }
                }
            }
        }

        // Use RSR if needed
        if (address(surplus) == address(0) && address(deficit) != address(0)) {
            IAsset rsrAsset = assetRegistry(trader).toAsset(rsr(trader));

            uint192 rsrAvailable = rsrAsset.bal(address(trader)).plus(
                rsrAsset.bal(address(stRSR(trader)))
            );
            if (isEnoughToSell(rsrAsset, rsrAvailable, minTradeVolume_)) {
                surplus = rsrAsset;
                surplusAmt = rsrAvailable;
            }
        }
    }

    /// Assuming we have `maxSellAmount` sell tokens available, prepare a trade to cover as much of
    /// our deficit of `deficitAmount` buy tokens as possible, given expected trade slippage the
    /// sell asset's maxTradeVolume().
    /// @param maxSellAmount {sellTok}
    /// @param deficitAmount {buyTok}
    /// @return notDust Whether the prepared trade is large enough to be worth trading
    /// @return trade The prepared trade
    //
    // Returns prepareTradeSell(sell, buy, sellAmount, sellPrice, buyPrice), where
    //   sellAmount = min(maxSellAmount,
    //                    deficitAmount * (buyPrice / sellPrice) / (1-maxTradeSlippage))
    //   i.e, the minimum of maxSellAmount and (a sale amount that, at current prices and maximum
    //   slippage, will yield at least the requested deficitAmount)
    //
    // Which means we should get that, if notDust is true, then:
    //   trade.sell = sell and trade.buy = buy
    //
    //   1 <= trade.minBuyAmount <= max(deficitAmount, buy.minTradeSize()).toQTok(buy)
    //   1 < trade.sellAmount <= max(sellAmount.toQTok(sell),
    //                               sell.maxTradeSize().toQTok(sell))
    //   trade.minBuyAmount ~= trade.sellAmount * sellPrice / buyPrice * (1-maxTradeSlippage)
    //
    //   trade.sellAmount (and trade.minBuyAmount) are maximal satisfying all these conditions
    function prepareTradeToCoverDeficit(
        ITrading trader,
        IAsset sell,
        IAsset buy,
        uint192 maxSellAmount,
        uint192 deficitAmount,
        uint192 sellPrice,
        uint192 buyPrice
    ) private view returns (bool notDust, TradeRequest memory trade) {
        // Don't buy dust.
        deficitAmount = fixMax(deficitAmount, minTradeSize(buy, trader.minTradeVolume()));

        // sell.strictPrice() cannot be zero below, because `nextTradePair` does not consider
        // assets with zero price
        assert(sellPrice > 0);

        // {sellTok} = {buyTok} * {UoA/buyTok} / {UoA/sellTok}
        uint192 exactSellAmount = deficitAmount.mulDiv(buyPrice, sellPrice, CEIL);
        // exactSellAmount: Amount to sell to buy `deficitAmount` if there's no slippage

        // slippedSellAmount: Amount needed to sell to buy `deficitAmount`, counting slippage
        uint192 slippedSellAmount = exactSellAmount.div(
            FIX_ONE.minus(trader.maxTradeSlippage()),
            CEIL
        );

        uint192 sellAmount = fixMin(slippedSellAmount, maxSellAmount);

        return prepareTradeSell(trader, sell, buy, sellAmount, sellPrice, buyPrice);
    }

    /// @param asset The asset in question
    /// @param amt {tok} The number of whole tokens we plan to sell
    /// @param minTradeVolume_ {UoA} The min trade volume, passed in for gas optimization
    /// @return If amt is sufficiently large to be worth selling into our trading platforms
    function isEnoughToSell(
        IAsset asset,
        uint192 amt,
        uint192 minTradeVolume_
    ) private view returns (bool) {
        // The Gnosis EasyAuction trading platform rounds defensively, meaning it is possible
        // for it to keep 1 qTok for itself. Therefore we should not sell 1 qTok. This is
        // likely to be true of all the trading platforms we integrate with.
        return
            amt.gte(minTradeSize(asset, minTradeVolume_)) &&
            // {qTok} = {tok} / {tok/qTok}
            amt.shiftl_toUint(int8(asset.erc20Decimals())) > 1;
    }

    // === Getters ===

    /// Calculates the minTradeSize for an asset based on the given minTradeVolume and price
    /// @param minTradeVolume_ {UoA} The min trade volume, passed in for gas optimization
    /// @return {tok} The min trade size for the asset in whole tokens
    function minTradeSize(IAsset asset, uint192 minTradeVolume_) private view returns (uint192) {
        (, uint192 price) = asset.price(true); // {UoA/tok}
        if (price == 0) return FIX_MAX;

        // {tok} = {UoA} / {UoA/tok}
        return minTradeVolume_.div(price, ROUND);
    }

    /// Calculates the maxTradeSize for an asset based on the asset's maxTradeVolume and price
    /// @return {tok} The max trade size for the asset in whole tokens
    function maxTradeSize(IAsset asset) private view returns (uint192) {
        (, uint192 price) = asset.price(true); // {UoA/tok}
        if (price == 0) return FIX_MAX;

        // {tok} = {UoA} / {UoA/tok}
        return asset.maxTradeVolume().div(price, ROUND);
    }

    /// @return The AssetRegistry
    function assetRegistry(ITrading trader) private view returns (IAssetRegistry) {
        return trader.main().assetRegistry();
    }

    /// @return The BasketHandler
    function basket(ITrading trader) private view returns (IBasketHandler) {
        return trader.main().basketHandler();
    }

    /// @return The RToken
    function rToken(ITrading trader) private view returns (IRToken) {
        return trader.main().rToken();
    }

    /// @return The RSR associated with this RToken
    function rsr(ITrading trader) private view returns (IERC20) {
        return trader.main().rsr();
    }

    function stRSR(ITrading trader) private view returns (IStRSR) {
        return trader.main().stRSR();
    }
}
