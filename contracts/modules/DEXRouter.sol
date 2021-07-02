// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "../interfaces/IAtomicExchange.sol";

import "../zeppelin/utils/Context.sol";
import "../zeppelin/token/ERC20/IERC20.sol";
import "../zeppelin/token/ERC20/utils/SafeERC20.sol";

import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";

contract DEXRouter is Context, IAtomicExchange {
    using SafeERC20 for IERC20;

    ISwapRouter public immutable swapRouter;

    constructor (address uniswapV3SwapRouter) {
        swapRouter = ISwapRouter(uniswapV3SwapRouter);
    }

    function tradeFixedSell(
        address sellToken, 
        address buyToken,
        uint256 sellAmount,
        uint256 minBuyAmount
    ) external override {
        sellToken;
        buyToken;
        sellAmoun;
        minBuyAmount;
        return;
    }
}
