// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@uniswap/v3-periphery/contracts/interfaces/INonfungiblePositionManager.sol";

/**
    @title Uniswap V3 Wrapper Interface
    @notice ERC20 Wrapper token for Uniswap V3 positions
    @author Gene A. Tsvigun
    @author Vic G. Larson
  */
interface IUniswapV3Wrapper is IERC20, IERC20Metadata {
    //TODO events

    function increaseLiquidity(uint256 amount0Desired, uint256 amount1Desired)
        external
        returns (
            uint128 liquidity,
            uint256 amount0,
            uint256 amount1
        );

    function decreaseLiquidity(uint128 liquidity) external returns (uint256 amount0, uint256 amount1);

    function positionId() external view returns (uint256);

    function claimRewards(address recipient)
        external
        returns (
            address token0,
            address token1,
            uint256 amount0,
            uint256 amount1
        );

    function principal()
        external
        view
        returns (
            address token0,
            address token1,
            uint256 amount0,
            uint256 amount1
        );

    function priceSimilarPosition()
        external
        view
        returns (
            address token0,
            address token1,
            uint256 amount0,
            uint256 amount1,
            uint128 liquidity
        );
}
