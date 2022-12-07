// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IMarket {
    function enter(
        IERC20 fromToken,
        uint256 amountIn,
        IERC20 toToken,
        uint256 minAmountOut,
        address swapTarget,
        bytes calldata swapCallData,
        address receiver
    ) external payable returns (uint256 amountOut);

    function exit(
        IERC20 fromToken,
        uint256 amountIn,
        IERC20 toToken,
        uint256 minAmountOut,
        address swapTarget,
        bytes calldata swapCallData,
        address receiver
    ) external payable returns (uint256 amountOut);
}
