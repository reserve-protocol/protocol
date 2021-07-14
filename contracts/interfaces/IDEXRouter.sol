// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

interface IDEXRouter {
    function tradeFixedSell(
        address sellToken,
        address buyToken,
        uint256 sellAmount,
        uint256 minBuyAmount
    ) external;
}
