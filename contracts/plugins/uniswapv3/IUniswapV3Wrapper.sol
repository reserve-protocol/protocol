// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { INonfungiblePositionManager } from "./INonfungiblePositionManager.sol";

interface IUniswapV3Wrapper is IERC20 {
    function mint(INonfungiblePositionManager.MintParams memory params) external;
    function increaseLiquidity(uint256 amount0Desired, uint256 amount1Desired) external returns (
            uint128 liquidity,
            uint256 amount0,
            uint256 amount1
    );

    function positions()
        external
        view
        returns (
            uint128 tokensOwed0,
            uint128 tokensOwed1
        );

    function decreaseLiquidity(uint128 liquidity) external returns (uint256 amount0, uint256 amount1);
    function collect(uint128 amount0Max, uint128 amount1Max) external returns (uint256 amount0, uint256 amount1);
    function positionId() external view returns (uint256);
    
}
