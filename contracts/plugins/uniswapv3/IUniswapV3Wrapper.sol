// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@uniswap/v3-periphery/contracts/interfaces/INonfungiblePositionManager.sol";

/**
    @title Uniswap V3 Wrapper Interface
    @notice ERC20 Wrapper token for Uniswap V3 positions
    @notice representing ERC721 NFT positions as ERC20 tokens with pro rata rewards sharing
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

    // UniswapV3 position NFT id
    function tokenId() external view returns (uint256);

    // Underlying assets provided as liquidity
    function token0() external view returns (address);

    function token1() external view returns (address);

    /** 
        @notice Increases the amount of liquidity in the wrapped position, with wrapper tokens paid by the `msg.sender`
        @param amount0Desired The desired amount of token0 to be spent
        @param amount1Desired The desired amount of token1 to be spent,
        @param amount0Min The minimum amount of token0 to spend, which serves as a slippage check,
        @param amount1Min The minimum amount of token1 to spend, which serves as a slippage check,
        @param deadline The time by which the transaction must be included to effect the change
        @return liquidity The new liquidity amount as a result of the increase
        @return amount0 The amount of token0 used to acheive resulting liquidity
        @return amount1 The amount of token1 used to acheive resulting liquidity
      */
    function increaseLiquidity(
        uint256 amount0Desired,
        uint256 amount1Desired,
        uint256 amount0Min,
        uint256 amount1Min,
        uint256 deadline
    ) external returns (uint128 liquidity, uint256 amount0, uint256 amount1);

    /** 
        @notice Decreases the amount of liquidity in the wrapped position and accounts it to the `msg.sender`
        @param liquidity The amount by which liquidity will be decreased
        @param amount0Min The minimum amount of token0 that should be accounted for the burned liquidity,
        @param amount1Min The minimum amount of token1 that should be accounted for the burned liquidity,
        @param deadline The time by which the transaction must be included to effect the change
        @return amount0 The amount of token0 accounted to the position's tokens owed
        @return amount1 The amount of token1 accounted to the position's tokens owed
    */
    function decreaseLiquidity(
        uint128 liquidity,
        uint256 amount0Min,
        uint256 amount1Min,
        uint256 deadline
    ) external returns (uint256 amount0, uint256 amount1);

    /**
        @notice Collects up to a maximum amount of fees owed by the holder of the wrapper token
        @notice calculated from the following values:
        @notice * all the fees ever acquired by the wrapped position
        @notice * balance history of the wrapper token holder (`msg.sender`) so far
        @notice * how much the wrapper token holder (`msg.sender`) was already paid
        @param recipient the recipient of the fees owed to `msg.sender`
        @return token0 first token address
        @return token1 second token address
        @return amount0 The amount of fees paid in token0
        @return amount1 The amount of fees paid in token1
     */
    function claimRewards(
        address recipient
    ) external returns (address token0, address token1, uint256 amount0, uint256 amount1);

    /**
        @notice Calculates the principal (currently acting as liquidity) locked in this wrapper
        @return amount0 total amount of token0 locked in the position
        @return amount1 total amount of token1 locked in the position
     */
    function principal() external view returns (uint256 amount0, uint256 amount1);

    /**
        @notice called when there's 0 liquidity wrapped to calculate the price of it
        @notice answers the question "how much of each token would it cost to acquire some liquitity"
        @return amount0 The amount of token0 required to create a particular amount of liquidity
        @return amount1 The amount of token1 required to create a particular amount of liquidity
        @return liquidity The amount of liquidity that can be created from amount0 and amount1 of respective tokens
     */
    function priceSimilarPosition()
        external
        view
        returns (uint256 amount0, uint256 amount1, uint128 liquidity);

    /**
        @notice https://docs.uniswap.org/contracts/v3/reference/core/libraries/Tick
    */
    function tick() external view returns (int24);
}
