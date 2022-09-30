// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/interfaces/IAsset.sol";
import "contracts/interfaces/IAssetRegistry.sol";
import "contracts/interfaces/ITrading.sol";
import "contracts/libraries/Fixed.sol";
import "./TradingLib.sol";

/**
 * @title TradePrepLib
 * @notice An internal lib for preparing individual trades on particular asset pairs
 */
library TradePrepLib {
    using FixLib for uint192;

    /// Prepare a trade to sell `trade.sellAmount` that guarantees a reasonable closing price,
    /// without explicitly aiming at a particular quantity to purchase.
    /// @param trade:
    ///   sell The sell asset
    ///   buy The buy asset
    ///   sellAmount {sellTok}
    ///   buyAmount {buyTok} IGNORED
    ///   sellPrice {UoA/sellTok} Can be 0
    ///   buyPrice {UoA/buyTok} Cannot be zero
    /// @return notDust True when the trade is larger than the dust amount
    /// @return req The prepared trade request to send to the Broker
    //
    // If notDust is true, then the returned trade request satisfies:
    //   req.sell == trade.sell and req.buy == trade.buy,
    //   req.minBuyAmount ~=
    //        trade.sellAmount * trade.sellPrice / trade.buyPrice * (1-maxTradeSlippage),
    //   req.sellAmount <= trade.sell.maxTradeSize().toQTok()
    //   1 < req.sellAmount
    //   and req.sellAmount is maximal such that req.sellAmount <= trade.sellAmount.toQTok(sell)
    //
    // If notDust is false, no trade exists that satisfies those constraints.
    function prepareTradeSell(TradeInfo memory trade, TradingRules memory rules)
        internal
        view
        returns (bool notDust, TradeRequest memory req)
    {
        assert(trade.buyPrice > 0); // checked for in RevenueTrader / prepareTradeRecapitalize
        // trade.sellPrice can be zero

        // Don't sell dust
        if (!isEnoughToSell(trade.sell, trade.sellAmount, rules.minTradeVolume)) {
            return (false, req);
        }

        // {sellTok} - uses sell.price(true)
        uint192 s = fixMin(trade.sellAmount, maxTradeSize(trade.sell));

        // {qSellTok}
        req.sellAmount = s.shiftl_toUint(int8(trade.sell.erc20Decimals()), FLOOR);

        // {buyTok} = {sellTok} * {UoA/sellTok} / {UoA/buyTok}
        uint192 b = s.mul(FIX_ONE.minus(rules.maxTradeSlippage)).mulDiv(
            trade.sellPrice,
            trade.buyPrice,
            CEIL
        );
        req.minBuyAmount = b.shiftl_toUint(int8(trade.buy.erc20Decimals()), CEIL);
        req.sell = trade.sell;
        req.buy = trade.buy;

        return (true, req);
    }

    /// Assuming we have `trade.sellAmount` sell tokens available, prepare a trade to cover as
    /// much of our deficit of `trade.buyAmount` buy tokens as possible, given expected trade
    /// slippage the sell asset's maxTradeVolume().
    /// @param trade.sellAmount {sellTok} maxSellAmount
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
    //   1 < req.sellAmount <= max(trade.sellAmount.toQTok(trade.sell),
    //                               sell.maxTradeSize().toQTok(trade.sell))
    //   req.minBuyAmount ~= trade.sellAmount * sellPrice / buyPrice * (1-maxTradeSlippage)
    //
    //   req.sellAmount (and req.minBuyAmount) are maximal satisfying all these conditions
    function prepareTradeToCoverDeficit(TradeInfo memory trade, TradingRules memory rules)
        internal
        view
        returns (bool notDust, TradeRequest memory req)
    {
        assert(trade.sellPrice > 0 && trade.buyPrice > 0);

        // Don't buy dust.
        trade.buyAmount = fixMax(trade.buyAmount, minTradeSize(trade.buy, rules.minTradeVolume));

        // {sellTok} = {buyTok} * {UoA/buyTok} / {UoA/sellTok}
        uint192 exactSellAmount = trade.buyAmount.mulDiv(trade.buyPrice, trade.sellPrice, CEIL);
        // exactSellAmount: Amount to sell to buy `deficitAmount` if there's no slippage

        // slippedSellAmount: Amount needed to sell to buy `deficitAmount`, counting slippage
        uint192 slippedSellAmount = exactSellAmount.div(
            FIX_ONE.minus(rules.maxTradeSlippage),
            CEIL
        );

        trade.sellAmount = fixMin(slippedSellAmount, trade.sellAmount); // {sellTok}
        return prepareTradeSell(trade, rules);
    }

    /// @param asset The asset in question
    /// @param amt {tok} The number of whole tokens we plan to sell
    /// @param minTradeVolume_ {UoA} The min trade volume, passed in for gas optimization
    /// @return If amt is sufficiently large to be worth selling into our trading platforms
    function isEnoughToSell(
        IAsset asset,
        uint192 amt,
        uint192 minTradeVolume_
    ) internal view returns (bool) {
        // The Gnosis EasyAuction trading platform rounds defensively, meaning it is possible
        // for it to keep 1 qTok for itself. Therefore we should not sell 1 qTok. This is
        // likely to be true of all the trading platforms we integrate with.
        return
            amt.gte(minTradeSize(asset, minTradeVolume_)) &&
            // {qTok} = {tok} / {tok/qTok}
            amt.shiftl_toUint(int8(asset.erc20Decimals())) > 1;
    }

    /// Calculates the minTradeSize for an asset based on the given minTradeVolume and price
    /// @param minTradeVolume_ {UoA} The min trade volume, passed in for gas optimization
    /// @return {tok} The min trade size for the asset in whole tokens
    function minTradeSize(IAsset asset, uint192 minTradeVolume_) internal view returns (uint192) {
        (, uint192 price) = asset.price(true); // {UoA/tok}
        if (price == 0) return FIX_MAX;

        // {tok} = {UoA} / {UoA/tok}
        return minTradeVolume_.div(price);
    }

    /// Calculates the maxTradeSize for an asset based on the asset's maxTradeVolume and price
    /// @return {tok} The max trade size for the asset in whole tokens
    function maxTradeSize(IAsset asset) internal view returns (uint192) {
        (, uint192 price) = asset.price(true); // {UoA/tok}
        if (price == 0) return FIX_MAX;

        // {tok} = {UoA} / {UoA/tok}
        return asset.maxTradeVolume().div(price);
    }
}
