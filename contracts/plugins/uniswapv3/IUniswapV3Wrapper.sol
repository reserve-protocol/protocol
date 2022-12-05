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
    /** 
        @notice Emitted when liquidity is increased for a wrapped position NFT
        @dev Also emitted when the wrapper contract is deployed
        @param tokenId The ID of the token for which liquidity was increased
        @param liquidity The amount by which liquidity for the wrapped NFT position was increased
        @param amount0 The amount of token0 that was paid for the increase in liquidity
        @param amount1 The amount of token1 that was paid for the increase in liquidity
     */
    event IncreaseWrappedLiquidity(
        uint256 indexed tokenId,
        uint128 liquidity,
        uint256 amount0,
        uint256 amount1
    );
    /**
        @notice Emitted when liquidity is decreased for a wrapped position NFT
        @param tokenId The ID of the token for which liquidity was decreased
        @param liquidity The amount by which liquidity for the wrapped NFT position was decreased
        @param amount0 The amount of token0 that was accounted for the decrease in liquidity
        @param amount1 The amount of token1 that was accounted for the decrease in liquidity
     */
    event DecreaseWrappedLiquidity(
        uint256 indexed tokenId,
        uint128 liquidity,
        uint256 amount0,
        uint256 amount1
    );

    function tokenId() external view returns (uint256);

    function token0() external view returns (address);

    function token1() external view returns (address);

    function increaseLiquidity(uint256 amount0Desired, uint256 amount1Desired)
        external
        returns (
            uint128 liquidity,
            uint256 amount0,
            uint256 amount1
        );

    function decreaseLiquidity(uint128 liquidity)
        external
        returns (uint256 amount0, uint256 amount1);

    function claimRewards(address recipient)
        external
        returns (
            address token0,
            address token1,
            uint256 amount0,
            uint256 amount1
        );

    function principal() external view returns (uint256 amount0, uint256 amount1);

    function priceSimilarPosition()
        external
        view
        returns (
            uint256 amount0,
            uint256 amount1,
            uint128 liquidity
        );
}
