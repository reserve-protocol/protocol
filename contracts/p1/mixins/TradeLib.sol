// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../../interfaces/IAsset.sol";
import "../../libraries/Fixed.sol";

struct TradeInfo {
    IAsset sell;
    IAsset buy;
    uint192 sellAmount; // {sellTok}
    uint192 buyAmount; // {buyTok}
    TradePrices prices;
}

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
    /// without explicitly aiming at a particular buy amount.
    /// @param trade:
    ///   sell != 0, sellAmount >= 0 {sellTok}, prices.sellLow >= 0 {UoA/sellTok}
    ///   buy != 0, buyAmount (unused) {buyTok}, prices.buyHigh > 0 {UoA/buyTok}
    /// @return notDust True when the trade is larger than the dust amount
    /// @return req The prepared trade request to send to the Broker
    //
    // If notDust is true, then the returned trade request satisfies:
    //   req.sell == trade.sell and req.buy == trade.buy,
    //   req.minBuyAmount * trade.prices.buyHigh ~=
    //        trade.sellAmount * trade.prices.sellLow * (1-maxTradeSlippage),
    //   req.sellAmount == min(trade.sell.maxTradeSize(), trade.sellAmount)
    //   1 < req.sellAmount
    //
    // If notDust is false, no trade exists that satisfies those constraints.
    function prepareTradeSell(
        TradeInfo memory trade,
        uint192 minTradeVolume,
        uint192 maxTradeSlippage
    ) internal view returns (bool notDust, TradeRequest memory req) {
        // checked for in RevenueTrader / CollateralizatlionLib
        assert(
            trade.prices.buyHigh != 0 &&
                trade.prices.buyHigh != FIX_MAX &&
                trade.prices.sellLow != FIX_MAX
        );

        notDust = isEnoughToSell(
            trade.sell,
            trade.sellAmount,
            trade.prices.sellLow,
            minTradeVolume
        );

        // Cap sell amount using the high price
        // Under price decay trade.prices.sellHigh can become up to 3x the savedHighPrice before
        // becoming FIX_MAX after the full price timeout
        uint192 s = trade.sellAmount;
        if (trade.prices.sellHigh != FIX_MAX) {
            // {sellTok}
            uint192 maxSell = maxTradeSize(trade.sell, trade.buy, trade.prices.sellHigh);
            require(maxSell > 1, "trade sizing error");
            if (s > maxSell) s = maxSell;
        } else {
            require(trade.prices.sellLow == 0, "trade pricing error");
        }

        // Calculate equivalent buyAmount within [0, FIX_MAX]
        // {buyTok} = {sellTok} * {1} * {UoA/sellTok} / {UoA/buyTok}
        uint192 b = s.mul(FIX_ONE.minus(maxTradeSlippage)).safeMulDiv(
            trade.prices.sellLow,
            trade.prices.buyHigh,
            CEIL
        );

        // {*tok} => {q*Tok}
        req.sellAmount = s.shiftl_toUint(int8(trade.sell.erc20Decimals()), FLOOR);
        req.minBuyAmount = b.shiftl_toUint(int8(trade.buy.erc20Decimals()), CEIL);
        req.sell = trade.sell;
        req.buy = trade.buy;

        return (notDust, req);
    }

    /// Assuming we have `trade.sellAmount` sell tokens available, prepare a trade to cover as
    /// much of our deficit of `trade.buyAmount` buy tokens as possible, given expected trade
    /// slippage and maxTradeVolume().
    /// @param trade:
    ///   sell != 0
    ///   buy != 0
    ///   sellAmount (unused) {sellTok}
    ///   buyAmount >= 0 {buyTok}
    ///   prices.sellLow > 0 {UoA/sellTok}
    ///   prices.buyHigh > 0 {UoA/buyTok}
    /// @return notDust Whether the prepared trade is large enough to be worth trading
    /// @return req The prepared trade request to send to the Broker
    //
    // Returns prepareTradeSell(trade, rules), where
    //   req.sellAmount = min(trade.sellAmount,
    //                trade.buyAmount * (buyHigh / sellLow) / (1-maxTradeSlippage))
    //   i.e, the minimum of trade.sellAmount and (a sale amount that, at current prices and
    //   maximum slippage, will yield at least the requested trade.buyAmount)
    //
    // Which means we should get that, if notDust is true, then:
    //   req.sell = sell and req.buy = buy
    //
    //   1 <= req.minBuyAmount <= max(trade.buyAmount, buy.minTradeSize()))
    //   1 < req.sellAmount <= min(trade.sellAmount, sell.maxTradeSize())
    //   req.minBuyAmount ~= trade.sellAmount * sellLow / buyHigh * (1-maxTradeSlippage)
    //
    //   req.sellAmount (and req.minBuyAmount) are maximal satisfying all these conditions
    function prepareTradeToCoverDeficit(
        TradeInfo memory trade,
        uint192 minTradeVolume,
        uint192 maxTradeSlippage
    ) internal view returns (bool notDust, TradeRequest memory req) {
        assert(
            trade.prices.sellLow != 0 &&
                trade.prices.sellLow != FIX_MAX &&
                trade.prices.buyHigh != 0 &&
                trade.prices.buyHigh != FIX_MAX
        );

        // Don't buy dust.
        trade.buyAmount = fixMax(
            trade.buyAmount,
            minTradeSize(minTradeVolume, trade.prices.buyHigh)
        );

        // {sellTok} = {buyTok} * {UoA/buyTok} / {UoA/sellTok}
        uint192 exactSellAmount = trade.buyAmount.mulDiv(
            trade.prices.buyHigh,
            trade.prices.sellLow,
            CEIL
        );
        // exactSellAmount: Amount to sell to buy `deficitAmount` if there's no slippage

        // slippedSellAmount: Amount needed to sell to buy `deficitAmount`, counting slippage
        uint192 slippedSellAmount = exactSellAmount.div(FIX_ONE.minus(maxTradeSlippage), CEIL);

        trade.sellAmount = fixMin(slippedSellAmount, trade.sellAmount); // {sellTok}
        return prepareTradeSell(trade, minTradeVolume, maxTradeSlippage);
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

    // === Private ===

    /// Calculates the minTradeSize for an asset based on the given minTradeVolume and price
    /// @param minTradeVolume {UoA} The min trade volume, passed in for gas optimization
    /// @return {tok} The min trade size for the asset in whole tokens
    function minTradeSize(uint192 minTradeVolume, uint192 price) private pure returns (uint192) {
        // {tok} = {UoA} / {UoA/tok}
        uint192 size = price == 0 ? FIX_MAX : minTradeVolume.div(price, CEIL);
        return size != 0 ? size : 1;
    }

    /// Calculates the maximum trade size for a trade pair of tokens
    /// @return {tok} The max trade size for the trade overall
    function maxTradeSize(
        IAsset sell,
        IAsset buy,
        uint192 price
    ) private view returns (uint192) {
        // D18{tok} = D18{UoA} / D18{UoA/tok}
        uint192 size = fixMin(sell.maxTradeVolume(), buy.maxTradeVolume()).safeDiv(price, FLOOR);
        return size != 0 ? size : 1;
    }
}
