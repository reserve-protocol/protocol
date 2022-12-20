// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/plugins/assets/ICToken.sol";

import "contracts/interfaces/IMarket.sol";

import "hardhat/console.sol";

contract CTokenMarket is IMarket {
    function enter(MarketCall calldata call) external override {
        ICToken cToken = ICToken(address(call.toToken));

        if (address(call.fromToken) == address(0)) {
            cToken.mint{ value: call.amountIn }();
        } else {
            call.fromToken.approve(address(cToken), call.amountIn);
            cToken.mint(call.amountIn);
        }
    }

    function exit(MarketCall calldata call) external override {
        ICToken(address(call.fromToken)).redeem(call.amountIn);
    }
}
