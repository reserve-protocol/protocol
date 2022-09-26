// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/interfaces/IAsset.sol";
import "contracts/interfaces/IAssetRegistry.sol";
import "contracts/interfaces/ITrading.sol";
import "contracts/libraries/Fixed.sol";

/**
 * @title TradingLibP1
 * @notice An informal extension of the Trading mixin that provides trade preparation views
 * @dev The caller must implement the ITrading interface!
 *
 * External-facing interface:
 *  1. prepareTradeSell
 *  2. prepareTradeRecapitalize
 */
library TradingLibP1 {
    using FixLib for uint192;

    /// Prepare a trade to sell `sellAmount` that guarantees a reasonable closing price,
    /// without explicitly aiming at a particular quantity to purchase.
    /// @param sellAmount {sellTok}
    /// @return notDust True when the trade is larger than the dust amount
    /// @return trade The prepared trade
    // Recall: struct TradeRequest is {IAsset sell, IAsset buy, uint sellAmount, uint minBuyAmount}
    //
    // If notDust is true, then the returned trade satisfies:
    //   trade.sell == sell and trade.buy == buy,
    //   trade.minBuyAmount ~= trade.sellAmount * sell.price() / buy.price() * (1-maxTradeSlippage),
    //   trade.sellAmount <= sell.maxTradeSize().toQTok(sell)
    //   1 < trade.sellAmount
    //   and trade.sellAmount is maximal such that trade.sellAmount <= sellAmount.toQTok(sell)
    //
    // If notDust is false, no such trade exists.

    function prepareTradeSell(
        IAsset sell,
        IAsset buy,
        uint192 sellAmount
    ) public view returns (bool notDust, TradeRequest memory trade) {
        trade.sell = sell;
        trade.buy = buy;

        // Don't sell dust
        if (!isEnoughToSell(sell, sellAmount, minTradeVolume())) return (false, trade);

        // {sellTok}
        uint192 s = fixMin(sellAmount, maxTradeSize(sell));

        // {qSellTok}
        trade.sellAmount = s.shiftl_toUint(int8(sell.erc20Decimals()), FLOOR);

        // {buyTok} = {sellTok} * {UoA/sellTok} / {UoA/buyTok}
        uint192 b = s.mul(FIX_ONE.minus(maxTradeSlippage())).mulDiv(
            sell.price(),
            buy.price(),
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

    /// Select and prepare a trade that moves us closer to capitalization using the
    /// basket range to avoid overeager/duplicate trading.
    function prepareTradeRecapitalize()
        external
        view
        returns (bool doTrade, TradeRequest memory req)
    {
        IERC20[] memory erc20s = assetRegistry().erc20s();

        // Compute basket range
        BasketRange memory range = basketRange(erc20s); // {BU}

        // Determine the largest surplus and largest deficit relative to the basket range
        (
            IAsset surplus,
            ICollateral deficit,
            uint192 surplusAmount,
            uint192 deficitAmount
        ) = nextTradePair(erc20s, range);

        if (address(surplus) == address(0) || address(deficit) == address(0)) return (false, req);

        // If we cannot trust surplus.price(), eliminate the minBuyAmount requirement

        if (
            surplus.isCollateral() &&
            assetRegistry().toColl(surplus.erc20()).status() != CollateralStatus.SOUND
        ) {
            (doTrade, req) = prepareTradeSell(surplus, deficit, surplusAmount);
            req.minBuyAmount = 0;
        } else {
            (doTrade, req) = prepareTradeToCoverDeficit(
                surplus,
                deficit,
                surplusAmount,
                deficitAmount
            );
        }

        // At this point doTrade _must_ be true, otherwise nextTradePair assumptions are broken
        assert(doTrade);

        return (doTrade, req);
    }

    // ==== End of external interface; Begin private helpers ===

    /// A range of baskets representing optimistic and pessimistic estimates
    function basketRange(IERC20[] memory erc20s) private view returns (BasketRange memory range) {
        uint192 basketPrice = basket().price();

        /**
         * - `assetsHigh`: The most we could get out of our assets. Assumes frictionless trades
         *     and reliable prices.
         * - `assetsLow`: The least we could get out of our assets. Assumes frictionless trades
         *     and zero for uncertain prices.
         */
        (uint192 assetsHigh, uint192 assetsLow) = totalAssetValue(erc20s); // {UoA}

        // {UoA} - Optimistic estimate of the value of the target number of basket units
        uint192 basketTargetHigh = fixMin(assetsHigh, rToken().basketsNeeded().mul(basketPrice));

        // Total value of missing collateral
        // Algo: For each collateral in the basket, compute the missing token balance relative to
        // the high basket target and convert this quantity to UoA using current market prices.
        uint192 shortfall = collateralShortfall(erc20s, basketTargetHigh); // {UoA}

        // Further adjust the low backing estimate downwards to account for trading frictions
        uint192 shortfallSlippage = maxTradeSlippage().mul(shortfall);
        uint192 basketTargetLow = assetsLow.gt(shortfallSlippage)
            ? fixMin(assetsLow.minus(shortfallSlippage), basketTargetHigh)
            : 0;

        // {BU} = {UoA} / {BU/UoA}
        range.top = basketTargetHigh.div(basketPrice, CEIL);
        range.bottom = basketTargetLow.div(basketPrice, CEIL);
    }

    /// Total value of all assets under management by BackingManager
    /// This includes all assets that the BackingManager holds directly + staked RSR
    /// @return assetsHigh {UoA} The high estimate of the total value of assets under management
    /// @return assetsLow {UoA} The low estimate of the total value of assets under management
    function totalAssetValue(IERC20[] memory erc20s)
        private
        view
        returns (uint192 assetsHigh, uint192 assetsLow)
    {
        // The low estimate is lower than the high estimate due to:
        // - Discounting unsound collateral
        // - Discounting dust amounts for collateral in the basket + non-dust assets

        IERC20 rsrERC20 = rsr();
        IBasketHandler bh = basket();
        uint192 minTradeVolume_ = minTradeVolume(); // {UoA}
        uint192 potentialDustLoss; // {UoA}

        for (uint256 i = 0; i < erc20s.length; ++i) {
            IAsset asset = assetRegistry().toAsset(erc20s[i]);
            uint192 bal = asset.bal(address(this));

            // For RSR, include the staking balance
            if (erc20s[i] == rsrERC20) bal = bal.plus(asset.bal(address(stRSR())));

            // Ignore dust amounts for assets not in the basket; their value is inaccessible
            bool inBasket = bh.quantity(erc20s[i]).gt(FIX_ZERO);
            if (!inBasket && !isEnoughToSell(asset, bal, minTradeVolume_)) {
                continue;
            }

            // {UoA} = {UoA} + {UoA/tok} * {tok}
            uint192 val = asset.price().mul(bal, FLOOR);

            // Consider all managed assets at face-value prices
            assetsHigh = assetsHigh.plus(val);

            // Accumulate potential losses to dust
            potentialDustLoss = potentialDustLoss.plus(minTradeVolume_);

            // Consider only reliable sources of value for the assetsLow estimate
            if (
                !asset.isCollateral() ||
                ICollateral(address(asset)).status() == CollateralStatus.SOUND
            ) {
                assetsLow = assetsLow.plus(val);
            }
        }

        // Account for all the places dust could get stuck
        assetsLow = assetsLow.gt(potentialDustLoss) ? assetsLow.minus(potentialDustLoss) : FIX_ZERO;
    }

    /// @param backing {UoA} An amount of backing in UoA terms
    /// @return shortfall {UoA} The missing re-collateralization in UoA terms
    function collateralShortfall(IERC20[] memory erc20s, uint192 backing)
        private
        view
        returns (uint192 shortfall)
    {
        IBasketHandler bh = basket();

        uint192 basketPrice = bh.price(); // {UoA/BU}
        for (uint256 i = 0; i < erc20s.length; ++i) {
            uint192 quantity = bh.quantity(erc20s[i]); // {tok/BU}
            if (quantity.eq(FIX_ZERO)) continue;

            // Cast: if the quantity is nonzero, then it must be collateral
            ICollateral coll = assetRegistry().toColl(erc20s[i]);

            // {tok} = {UoA} * {tok/BU} / {UoA/BU}
            uint192 needed = backing.mulDiv(quantity, basketPrice, CEIL); // {tok}
            uint192 held = coll.bal(address(this)); // {tok}

            if (held.lt(needed)) {
                // {UoA} = {UoA} + ({tok} - {tok}) * {UoA/tok}
                shortfall = shortfall.plus(needed.minus(held).mul(coll.price(), FLOOR));
            }
        }
    }

    // Choose next sell/buy pair to trade, with reference to the basket range
    // Exclude dust amounts for surplus
    /// @return surplus Surplus asset OR address(0)
    /// @return deficit Deficit collateral OR address(0)
    /// @return surplusAmt {sellTok} Surplus amount (whole tokens)
    /// @return deficitAmt {buyTok} Deficit amount (whole tokens)
    function nextTradePair(IERC20[] memory erc20s, BasketRange memory range)
        private
        view
        returns (
            IAsset surplus,
            ICollateral deficit,
            uint192 surplusAmt,
            uint192 deficitAmt
        )
    {
        IBasketHandler bh = basket();
        uint192 maxSurplus; // {UoA}
        uint192 maxDeficit; // {UoA}

        // We're at the stack var limit in this function; there are at least 2
        // locations we'd like to use cached values but can't.

        for (uint256 i = 0; i < erc20s.length; ++i) {
            if (erc20s[i] == rsr()) continue;

            IAsset asset = assetRegistry().toAsset(erc20s[i]);
            uint192 bal = asset.bal(address(this));

            // {tok} = {BU} * {tok/BU}
            // needed(Top): token balance needed at top of the basket range
            uint192 needed = range.top.mul(bh.quantity(erc20s[i]), CEIL); // {tok}
            if (bal.gt(needed)) {
                uint192 amtExtra = bal.minus(needed); // {tok}

                // {UoA} = {tok} * {UoA/tok}
                uint192 delta = amtExtra.mul(asset.price(), FLOOR);
                if (delta.gt(maxSurplus) && isEnoughToSell(asset, amtExtra, minTradeVolume())) {
                    surplus = asset;
                    maxSurplus = delta;
                    surplusAmt = amtExtra;
                }
            } else {
                // needed(Bottom): token balance needed at bottom of the basket range
                needed = range.bottom.mul(bh.quantity(erc20s[i]), CEIL); // {tok};
                if (bal.lt(needed)) {
                    uint192 amtShort = needed.minus(bal); // {tok}

                    // {UoA} = {tok} * {UoA/tok}
                    uint192 delta = amtShort.mul(asset.price(), CEIL);
                    if (delta.gt(maxDeficit)) {
                        deficit = ICollateral(address(asset));
                        maxDeficit = delta;
                        deficitAmt = amtShort;
                    }
                }
            }
        }

        // Use RSR if needed
        if (address(surplus) == address(0) && address(deficit) != address(0)) {
            IAsset rsrAsset = assetRegistry().toAsset(rsr());

            uint192 rsrAvailable = rsrAsset.bal(address(this)).plus(rsrAsset.bal(address(stRSR())));
            if (rsrAvailable.gt(minTradeSize(rsrAsset, minTradeVolume()))) {
                surplus = rsrAsset;
                surplusAmt = rsrAvailable;
            }
        }
    }

    /// Assuming we have `maxSellAmount` sell tokens available, prepare a trade to
    /// cover as much of our deficit as possible, given expected trade slippage and
    /// the sell asset's maxTradeVolume().
    /// @param maxSellAmount {sellTok}
    /// @param deficitAmount {buyTok}
    /// @return notDust Whether the prepared trade is large enough to be worth trading
    /// @return trade The prepared trade
    function prepareTradeToCoverDeficit(
        IAsset sell,
        IAsset buy,
        uint192 maxSellAmount,
        uint192 deficitAmount
    ) private view returns (bool notDust, TradeRequest memory trade) {
        // Don't buy dust.
        deficitAmount = fixMax(deficitAmount, minTradeSize(buy, minTradeVolume()));

        // {sellTok} = {buyTok} * {UoA/buyTok} / {UoA/sellTok}
        uint192 exactSellAmount = deficitAmount.mulDiv(buy.price(), sell.price(), CEIL);
        // exactSellAmount: Amount to sell to buy `deficitAmount` if there's no slippage

        // slippedSellAmount: Amount needed to sell to buy `deficitAmount`, counting slippage
        uint192 slippedSellAmount = exactSellAmount.div(FIX_ONE.minus(maxTradeSlippage()), CEIL);

        uint192 sellAmount = fixMin(slippedSellAmount, maxSellAmount);

        return prepareTradeSell(sell, buy, sellAmount);
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
        uint192 price = asset.priceWithFailover(); // {UoA/tok}
        require(price > 0, "insufficient asset pricing");
        // this is a require and not an assert because it's likely to arise from incorrect asset
        // configuration, and the assets are not "inside" the system

        // {tok} = {UoA} / {UoA/tok}
        return minTradeVolume_.div(price);
    }

    /// Calculates the maxTradeSize for an asset based on the asset's maxTradeVolume and price
    /// @return {tok} The max trade size for the asset in whole tokens
    function maxTradeSize(IAsset asset) private view returns (uint192) {
        uint192 price = asset.priceWithFailover(); // {UoA/tok}
        require(price > 0, "insufficient asset pricing");
        // this is a require and not an assert because it's likely to arise from incorrect asset
        // configuration, and the assets are not "inside" the system

        // {tok} = {UoA} / {UoA/tok}
        return asset.maxTradeVolume().div(price);
    }

    /// @return {%}
    function maxTradeSlippage() private view returns (uint192) {
        return ITrading(address(this)).maxTradeSlippage();
    }

    /// @return {UoA}
    function minTradeVolume() private view returns (uint192) {
        return ITrading(address(this)).minTradeVolume();
    }

    /// @return The AssetRegistry
    function assetRegistry() private view returns (IAssetRegistry) {
        return ITrading(address(this)).main().assetRegistry();
    }

    /// @return The BasketHandler
    function basket() private view returns (IBasketHandler) {
        return ITrading(address(this)).main().basketHandler();
    }

    /// @return The RToken
    function rToken() private view returns (IRToken) {
        return ITrading(address(this)).main().rToken();
    }

    /// @return The RSR associated with this RToken
    function rsr() private view returns (IERC20) {
        return ITrading(address(this)).main().rsr();
    }

    function stRSR() private view returns (IStRSR) {
        return ITrading(address(this)).main().stRSR();
    }
}
