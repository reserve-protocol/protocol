// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/plugins/assets/ICToken.sol";

import "./AbstractMarket.sol";

contract CTokenMarket is AbstractMarket {
    function enter(MarketCall calldata call) external payable override {
        ICToken cToken = ICToken(address(call.toToken));

        if (address(call.fromToken) == ETH) {
            cToken.mint{ value: call.value }();
        } else {
            call.fromToken.approve(address(cToken), call.amountIn);
            cToken.mint(call.amountIn);
        }
    }

    function exit(MarketCall calldata call) external payable override {
        ICToken(address(call.fromToken)).redeem(call.amountIn);
    }
}
