// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "../../interfaces/IBroker.sol";
import "../../interfaces/ITrading.sol";
import "../../libraries/Fixed.sol";

/**
 * @title SwapLib
 * @notice
 */
library SwapLib {
    using FixLib for uint192;

    enum SwapVariant {
        CALCULATE_BUY_AMOUNT,
        CALCULATE_SELL_AMOUNT
    }

    /// @dev One of the TradeRequest amounts will be overwritten depending on the SwapVariant
    /// @param req The TradeRequest
    /// @param pricepoint {1} the percentile price to choose among the lowest and highest possible
    /// @param variant Determines whether the buy amount or sell amount will be overwritten
    function prepareSwap(
        TradeRequest memory req,
        uint192 pricepoint,
        SwapVariant variant
    ) external view returns (Swap memory s) {
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
}
