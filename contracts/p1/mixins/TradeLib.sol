// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../../interfaces/IAsset.sol";
import "../../interfaces/IAssetRegistry.sol";
import "../../interfaces/ITrading.sol";
import "../../libraries/Fixed.sol";
import "./RecollateralizationLib.sol";

/**
 * @title TradeLib
 * @notice An internal lib for preparing individual trades on particular asset pairs
 *   Users:
 *     - BackingManagerLib
 *     - RevenueTrader
 */
library TradeLib {
    using FixLib for uint192;

    /// @dev Caller must be ITrading
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
    //        trade.sellAmount * trade.sellPrice * (1-rules.maxTradeSlippage),
    //   req.sellAmount == min(trade.sell.maxTradeSize().toQTok(), trade.sellAmount.toQTok(sell)
    //   1 < req.sellAmount
    //
    // If notDust is false, no trade exists that satisfies those constraints.
    function prepareTradeSell(
        TradeInfo memory trade,
        TradingRules memory rules
    ) internal view returns (bool notDust, TradeRequest memory req) {
        // checked for in RevenueTrader / CollateralizatlionLib
        assert(trade.buyPrice > 0 && trade.buyPrice < FIX_MAX && trade.sellPrice < FIX_MAX);

        // Don't sell dust
        if (!isEnoughToSell(trade.sell, trade.sellAmount, rules.minTradeVolume)) {
            return (false, req);
        }

        // Cap sell amount
        uint192 maxSell = maxTradeSize(trade.sell, trade.sell.lotPrice()); // {sellTok}
        uint192 s = trade.sellAmount > maxSell ? maxSell : trade.sellAmount; // {sellTok}

        // Calculate equivalent buyAmount within [0, FIX_MAX]
        // {buyTok} = {sellTok} * {1} * {UoA/sellTok} / {UoA/buyTok}
        uint192 b = safeMulDivCeil(
            ITrading(address(this)),
            s.mul(FIX_ONE.minus(rules.maxTradeSlippage)),
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
        TradingRules memory rules
    ) internal view returns (bool notDust, TradeRequest memory req) {
        assert(
            trade.sellPrice > 0 &&
                trade.sellPrice < FIX_MAX &&
                trade.buyPrice > 0 &&
                trade.buyPrice < FIX_MAX
        );

        // Don't buy dust.
        trade.buyAmount = fixMax(
            trade.buyAmount,
            minTradeSize(rules.minTradeVolume, trade.buyPrice)
        );

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

    /// @param asset The asset in consideration
    /// @param amt {tok} The number of whole tokens we plan to sell
    /// @param minTradeVolume {UoA} The min trade volume, passed in for gas optimization
    /// @return If amt is sufficiently large to be worth selling into our trading platforms
    function isEnoughToSell(
        IAsset asset,
        uint192 amt,
        uint192 minTradeVolume
    ) internal view returns (bool) {
        return
            amt.gte(minTradeSize(minTradeVolume, asset.lotPrice())) &&
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
        } catch Error(string memory reason) {
            // The only expected error is FixLib.UIntOutOfBounds
            assert(
                keccak256(abi.encodePacked(reason)) ==
                    keccak256(abi.encodePacked("UIntOutOfBounds()"))
            );
        } catch Panic(uint errorCode) {
            // 0x11: overflow
            // 0x12: div-by-zero
            assert(errorCode == 0x11 || errorCode == 0x12);
        } catch {
            // It should not be possible to reach this line
            assert(false);
        }
        return FIX_MAX;
    }

    // === Private ===

    /// Calculates the minTradeSize for an asset based on the given minTradeVolume and price
    /// @param minTradeVolume {UoA} The min trade volume, passed in for gas optimization
    /// @return {tok} The min trade size for the asset in whole tokens
    function minTradeSize(uint192 minTradeVolume, uint192 price) private pure returns (uint192) {
        // {tok} = {UoA} / {UoA/tok}
        uint192 size = price == 0 ? FIX_MAX : minTradeVolume.div(price, ROUND);
        return size > 0 ? size : 1;
    }

    /// Calculates the maxTradeSize for an asset based on the asset's maxTradeVolume and price
    /// @return {tok} The max trade size for the asset in whole tokens
    function maxTradeSize(IAsset asset, uint192 price) private view returns (uint192) {
        uint192 size = price == 0 ? FIX_MAX : asset.maxTradeVolume().div(price, ROUND);
        return size > 0 ? size : 1;
    }
}
