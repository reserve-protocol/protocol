// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/plugins/assets/ICToken.sol";

import "./AbstractMarket.sol";

contract CTokenMarket is AbstractMarket {
    function enter(MarketCall calldata call)
        external
        payable
        virtual
        override
        returns (uint256 amountOut)
    {
        if (call.amountIn == 0) revert InsufficientInput();

        ICToken cToken = ICToken(address(call.toToken));
        uint256 initialBalance = _getBalance(call.toToken);

        if (address(call.fromToken) == address(0)) {
            cToken.mint{ value: call.amountIn }();
        } else {
            call.fromToken.approve(address(cToken), call.amountIn);
            cToken.mint(call.amountIn);
        }

        amountOut = _getBalance(call.toToken) - initialBalance;
        if (amountOut < call.minAmountOut) revert InsufficientOutput();
    }

    function exit(MarketCall calldata call)
        external
        payable
        virtual
        override
        returns (uint256 amountOut)
    {
        if (msg.value != 0) revert InvalidValue();
        if (call.amountIn == 0) revert InsufficientInput();

        uint256 initialBalance = _getBalance(call.toToken);

        ICToken(address(call.toToken)).redeem(call.amountIn);

        amountOut = _getBalance(call.toToken) - initialBalance;
        if (amountOut < call.minAmountOut) revert InsufficientOutput();
    }
}
