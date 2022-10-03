// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/interfaces/IAsset.sol";
import "contracts/interfaces/IAssetRegistry.sol";
import "contracts/interfaces/ITrading.sol";
import "contracts/libraries/Fixed.sol";
import "./RecollateralizationLib.sol";

/**
 * @title TradeLib
 * @notice An internal lib for preparing individual trades on particular asset pairs
 *   Users:
 *     - RecollateralizationLib
 *     - RevenueTrader
 */
library TradeLib {
    using FixLib for uint192;

    /// Prepare a trade to sell `trade.sellAmount` that guarantees a reasonable closing price,
    /// without explicitly aiming at a particular quantity to purchase.
    /// @param trade:
    ///   sell != 0, sellAmount >= 0 {sellTok}, sellPrice >= 0 {UoA/sellTok},
    ///   buy != 0, buyAmount (unused) {buyTok}, buyPrice > 0 {UoA/buyTok}
    /// @return notDust True when the trade is larger than the dust amount
    /// @return req The prepared trade request to send to the Broker
    //
    // If notDust is true, then the returned trade request satisfies:
    //   req.sell == trade.sell and req.buy == trade.buy,
    //   req.minBuyAmount * trade.buyPrice ~==
    //        trade.sellAmount * trade.sellPrice * (1-rules.maxTradeSlippage),
    //   req.sellAmount == min(trade.sell.maxTradeSize().toQTok(), trade.sellAmount.toQTok(sell))
    //   1 < req.sellAmount
    //
    // If notDust is false, no trade exists that satisfies those constraints.
    function prepareTradeSell(TradeInfo memory trade, TradingRules memory rules)
        internal
        view
        returns (bool notDust, TradeRequest memory req)
    {
        assert(trade.buyPrice > 0); // checked for in RevenueTrader / CollateralizatlionLib
        // assert(trade.sellPrice >= 0);

        // Don't sell dust
        if (!isEnoughToSell(trade.sell, trade.sellAmount, rules.minTradeVolume)) {
            return (false, req);
        }

        (, uint192 price) = trade.sell.price(true); // {UoA/tok}
        // may use fallback price for sell asset

        // {sellTok} - reads trade.sell.price(true)
        uint192 sellAmt = fixMin(trade.sellAmount, maxTradeSize(trade.sell, price));

        // {buyTok} = {sellTok} * {UoA/sellTok} / {UoA/buyTok}
        uint192 buyAmt = sellAmt
            .mul(FIX_ONE.minus(rules.maxTradeSlippage))
            .mul(trade.sellPrice)
            .div(trade.buyPrice, CEIL);

        // Build the TradeRequest by converting to uint256 {QTok} values:
        req.sell = trade.sell;
        req.buy = trade.buy;
        req.sellAmount = sellAmt.shiftl_toUint(int8(trade.sell.erc20Decimals()), FLOOR);
        req.minBuyAmount = buyAmt.shiftl_toUint(int8(trade.buy.erc20Decimals()), CEIL);

        return (true, req);
    }

    /// Assuming we have `trade.sellAmount` sell tokens available, prepare a trade to cover as
    /// much of our deficit of `trade.buyAmount` buy tokens as possible, given expected trade
    /// slippage and the sell asset's maxTradeVolume().
    /// @param trade checks:
    ///   sell != 0, sellAmount (unused) {sellTok}, sellPrice > 0 {UoA/sellTok},
    ///   buy != 0, buyAmount >= 0 {buyTok}, buyPrice > 0 {UoA/buyTok}
    /// @return notDust Whether the supplied assets are large enough to be worth trading
    /// @return req The prepared trade request to send to the Broker
    //
    // If notDust is true, then:
    //   req.sell = sell and req.buy = buy
    //   1 <= req.minBuyAmount <= max(trade.buyAmount, buy.minTradeSize()).toQTok(trade.buy)
    //   1 < req.sellAmount <= min(trade.sellAmount.toQTok(trade.sell),
    //                               sell.maxTradeSize().toQTok(trade.sell))
    //   req.minBuyAmount * trade.buyPrice ~=
    //       trade.sellAmount * trade.sellPrice * (1-rules.maxTradeSlippage)
    //   req.sellAmount (and req.minBuyAmount) are maximal satisfying all these conditions
    function prepareTradeToCoverDeficit(TradeInfo memory trade, TradingRules memory rules)
        internal
        view
        returns (bool notDust, TradeRequest memory req)
    {
        assert(trade.sellPrice > 0 && trade.buyPrice > 0);

        // If you only have dust to sell then don't sell anything
        if (!isEnoughToSell(trade.sell, trade.sellAmount, rules.minTradeVolume)) {
            return (false, req);
        }

        // Do not aim to buy mere dust; Aim to buy more.
        uint192 maxBuyAmt = fixMax(
            trade.buyAmount,
            minTradeSize(rules.minTradeVolume, trade.buyPrice)
        ); // {buyTok}

        // Sell at most the offered token balance and at most the maxTradeSize()
        uint192 maxSellAmt = fixMin(trade.sellAmount, maxTradeSize(trade.sell, trade.sellPrice));

        // We want buyAmt * buyPrice ~== sellAmt * sellPrice * afterSlippage,
        // And so our request should happen at the following biy-per-sell price:
        // {sellTok/buyTok} = {UoA / buyTok} / {UoA / sellTok} / {1}
        uint192 requestPrice = (trade.buyPrice).div(trade.sellPrice, CEIL).div(
            FIX_ONE.minus(rules.maxTradeSlippage),
            CEIL
        );

        // Now, buyAmt <= maxBuyAmt, sellAmt <= maxSellAmt, buyAmt / sellAmt = requestPrice
        // and at least one of those inequalities should be an equality. Thus:
        uint192 buyAmt; // {buyTok}
        uint192 sellAmt; // {sellTok}

        // {buyTok} * {sellTok/buyTok} >= {sellTok}
        if (maxBuyAmt.mul(requestPrice) >= maxSellAmt) {
            // {buyTok} = {sellTok} / {sellTok/buyTok}
            buyAmt = maxSellAmt.div(requestPrice); // FLOOR
            sellAmt = maxSellAmt;
        } else {
            // {sellTok} = {buyTok} * {sellTok/buyTok}
            sellAmt = maxBuyAmt.mul(requestPrice, CEIL); // TODO rounding
            buyAmt = maxBuyAmt;
        }

        // Build the TradeRequest by converting to uint256 {QTok} values:
        req.sell = trade.sell;
        req.buy = trade.buy;
        req.sellAmount = sellAmt.shiftl_toUint(int8(trade.sell.erc20Decimals()), FLOOR);
        req.minBuyAmount = buyAmt.shiftl_toUint(int8(trade.buy.erc20Decimals()), CEIL);
        // TODO why these rounds...

        return (true, req);
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
        (, uint192 price) = asset.price(true); // {UoA/tok}
        // can be a fallback price

        // The Gnosis EasyAuction trading platform rounds defensively, meaning it is possible
        // for it to keep 1 qTok for itself. Therefore we should not sell 1 qTok. This is
        // likely to be true of all the trading platforms we integrate with.
        return
            amt.gte(minTradeSize(minTradeVolume_, price)) &&
            // {qTok} = {tok} / {tok/qTok}
            amt.shiftl_toUint(int8(asset.erc20Decimals())) > 1;
    }

    // === Private ===

    /// Calculates the minTradeSize for an asset based on the given minTradeVolume and price
    /// @param minTradeVolume_ {UoA} The min trade volume, passed in for gas optimization
    /// @return {tok} The min trade size for the asset in whole tokens
    function minTradeSize(uint192 minTradeVolume_, uint192 price) private pure returns (uint192) {
        // {tok} = {UoA} / {UoA/tok}
        return price == 0 ? FIX_MAX : minTradeVolume_.div(price, CEIL);
    }

    /// Calculates the maxTradeSize for an asset based on the asset's maxTradeVolume and price
    /// @return {tok} The max trade size for the asset in whole tokens
    function maxTradeSize(IAsset asset, uint192 price) private view returns (uint192) {
        return price == 0 ? FIX_MAX : asset.maxTradeVolume().div(price, CEIL);
    }
}
