// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "./AbstractMarket.sol";
import "../ICToken.sol";

contract CTokenMarket is AbstractMarket {
    function enter(MarketCall calldata call)
        external
        payable
        virtual
        override
        returns (uint256 amountOut)
    {
        require(call.amountIn != 0, "CTokenMarket: INSUFFICIENT_INPUT");

        ICToken cToken = ICToken(address(call.toToken));
        uint256 initialBalance = cToken.balanceOf(address(this));

        if (address(call.fromToken) == address(0)) {
            cToken.mint{ value: call.amountIn }();
        } else {
            call.fromToken.approve(address(cToken), call.amountIn);
            cToken.mint(call.amountIn);
        }

        amountOut = cToken.balanceOf(address(this)) - initialBalance;
        require(amountOut >= call.minAmountOut, "CTokenMarket: INSUFFICIENT_OUTPUT");
    }

    function exit(MarketCall calldata call)
        external
        payable
        virtual
        override
        returns (uint256 amountOut)
    {
        require(msg.value == 0, "CTokenMarket: INVALID_VALUE");
        require(call.amountIn != 0, "CTokenMarket: INSUFFICIENT_INPUT");

        ICToken cToken = ICToken(address(call.fromToken));

        if (address(call.toToken) == address(0)) {
            uint256 initialBalance = address(this).balance;
            cToken.redeem(call.amountIn);
            amountOut = address(this).balance - initialBalance;
        } else {
            uint256 initialBalance = call.toToken.balanceOf(address(this));
            cToken.redeem(call.amountIn);
            amountOut = call.toToken.balanceOf(address(this)) - initialBalance;
        }

        require(amountOut >= call.minAmountOut, "CTokenMarket: INSUFFICIENT_OUTPUT");
    }
}
