// SPDX-License-Identifier: BlueOak-1.0.0 
pragma solidity ^0.8.0;
interface IFraxSwapRouter {
    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external returns (uint[] memory amounts);
}