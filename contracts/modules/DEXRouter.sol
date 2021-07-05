// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "../interfaces/IAtomicExchange.sol";

import "../external/zeppelin/token/ERC20/IERC20.sol";
import "../external/zeppelin/token/ERC20/utils/SafeERC20.sol";
import "../external/uniswap/ISwapRouter.sol";
import "../external/uniswap/IUniswapV3SwapCallback.sol";
import "../external/uniswap/IUniswapV3Pool.sol";

contract DEXRouter is IAtomicExchange, IUniswapV3SwapCallback {
    using SafeERC20 for IERC20;

    ISwapRouter public immutable swapper;

    constructor (address uniswapSwapAddress) {
        swapper = ISwapRouter(uniswapSwapAddress);
    }

    function tradeFixedSell(
        address sellToken, 
        address buyToken,
        uint256 sellAmount,
        uint256 minBuyAmount
    ) external override {
        uint24 fee = 3000; // .3% fee tier

        ISwapRouter.ExactInputSingleParams memory swapParams = ISwapRouter.ExactInputSingleParams({
            tokenIn: sellToken,
            tokenOut: buyToken,
            fee: fee, 
            recipient: msg.sender,
            deadline: block.timestamp, // require the trade completes in this block
            amountIn: sellAmount,
            amountOutMinimum: minBuyAmount,
            sqrtPriceLimitX96: 0 // TODO: Confirm
        });
        require(swapper.exactInputSingle(swapParams) > minBuyAmount, "buy too low");
    }

    function uniswapV3SwapCallback(
        int256 amount0Delta,
        int256 amount1Delta,
        bytes calldata data
    ) external override {
        address sender = abi.decode(data, (address));

        if (amount0Delta > 0) {
            IERC20(IUniswapV3Pool(msg.sender).token0()).transferFrom(sender, msg.sender, uint256(amount0Delta));
        } else if (amount1Delta > 0) {
            IERC20(IUniswapV3Pool(msg.sender).token1()).transferFrom(sender, msg.sender, uint256(amount1Delta));
        }
    }

}
