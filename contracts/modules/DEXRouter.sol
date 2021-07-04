// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "../interfaces/IAtomicExchange.sol";

import "../dependencies/zeppelin/utils/Context.sol";
import "../dependencies/zeppelin/token/ERC20/IERC20.sol";
import "../dependencies/zeppelin/token/ERC20/utils/SafeERC20.sol";
import "../dependencies/uniswap/ISwapRouter.sol";

contract DEXRouter is Context, IAtomicExchange {
    using SafeERC20 for IERC20;

    ISwapRouter public immutable uniswapSwapRouter;

    constructor (address uniswapV3SwapRouter) {
        uniswapSwapRouter = ISwapRouter(uniswapV3SwapRouter);
    }

    function tradeFixedSell(
        address sellToken, 
        address buyToken,
        uint256 sellAmount,
        uint256 minBuyAmount
    ) external override {
        sellToken;
        buyToken;
        sellAmount;
        minBuyAmount;
        return;
    }
}
