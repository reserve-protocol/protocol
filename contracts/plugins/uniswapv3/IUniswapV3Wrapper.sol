// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { INonfungiblePositionManager } from "./INonfungiblePositionManager.sol";

interface IUniswapV3Wrapper is IERC20 {
    function mint(INonfungiblePositionManager.MintParams memory params)
        external
        returns (
            uint256 tokenId,
            uint128 liquidity,
            uint256 amount0,
            uint256 amount1
        );

    function increaseLiquidity(uint256 amount0Desired, uint256 amount1Desired)
        external
        returns (
            uint128 liquidity,
            uint256 amount0,
            uint256 amount1
        );

    function positions()
        external
        view
        returns (
            uint96 nonce,
            address operator,
            address token0,
            address token1,
            uint24 fee,
            int24 tickLower,
            int24 tickUpper,
            uint128 liquidity,
            uint256 feeGrowthInside0LastX128,
            uint256 feeGrowthInside1LastX128,
            uint128 tokensOwed0,
            uint128 tokensOwed1
        );

    function decreaseLiquidity(uint128 liquidity) external returns (uint256 amount0, uint256 amount1);

    function positionId() external view returns (uint256);
}
