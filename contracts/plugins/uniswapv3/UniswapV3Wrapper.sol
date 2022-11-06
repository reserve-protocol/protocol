// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.9;

import { IUniswapV3Wrapper } from "./IUniswapV3Wrapper.sol";
import { INonfungiblePositionManager } from "./INonfungiblePositionManager.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract UniswapV3Wrapper is ERC20, IUniswapV3Wrapper, ReentrancyGuard {
    uint256 positionTokenId;
    uint128 positionLiquidity;

    INonfungiblePositionManager nonfungilePositionManager =
        INonfungiblePositionManager(0xC36442b4a4522E871399CD717aBDD847Ab11FE88);

    constructor(
        INonfungiblePositionManager.MintParams memory params,
        string memory name_,
        string memory symbol_
    ) ERC20(name_, symbol_) {
        params.recipient = address(this);
        params.deadline = block.timestamp;
        (positionTokenId, positionLiquidity, , ) = nonfungilePositionManager.mint(params);
        _mint(msg.sender, positionLiquidity);
    }

    function increaseLiquidity(uint256 amount0Desired, uint256 amount1Desired)
        external
        nonReentrant
        returns (
            uint128 liquidity,
            uint256 amount0,
            uint256 amount1
        )
    {
        INonfungiblePositionManager.IncreaseLiquidityParams memory increaseLiquidityParams;
        increaseLiquidityParams.tokenId = positionTokenId;
        increaseLiquidityParams.amount0Desired = amount0Desired;
        increaseLiquidityParams.amount1Desired = amount1Desired;
        increaseLiquidityParams.amount0Min = 0;
        increaseLiquidityParams.amount1Min = 0;
        increaseLiquidityParams.deadline = block.timestamp;
        (liquidity, amount0, amount1) = nonfungilePositionManager.increaseLiquidity(
            increaseLiquidityParams
        );
        positionLiquidity = liquidity;
        _mint(msg.sender, liquidity);
    }

    function decreaseLiquidity(uint128 liquidity)
        external
        nonReentrant
        returns (uint256 amount0, uint256 amount1)
    {
        INonfungiblePositionManager.DecreaseLiquidityParams memory decreaseLiquidityParams;
        decreaseLiquidityParams.tokenId = positionTokenId;
        decreaseLiquidityParams.amount0Min = 0;
        decreaseLiquidityParams.amount1Min = 0;
        decreaseLiquidityParams.deadline = block.timestamp;
        (amount0, amount1) = nonfungilePositionManager.decreaseLiquidity(decreaseLiquidityParams);
        positionLiquidity -= liquidity;
        _burn(msg.sender, liquidity);
    }

    function positions() external view returns (uint128 tokensOwed0, uint128 tokensOwed1) {
        (, , , , , , , , , , tokensOwed0, tokensOwed1) = nonfungilePositionManager.positions(
            positionTokenId
        );
    }

    function collect(uint128 amount0Max, uint128 amount1Max)
        external
        returns (uint256 amount0, uint256 amount1)
    {
        INonfungiblePositionManager.CollectParams memory collectParams;
        collectParams.tokenId = positionTokenId;
        collectParams.recipient = msg.sender;
        collectParams.amount0Max = amount0Max;
        collectParams.amount1Max = amount1Max;
        (amount0, amount1) = nonfungilePositionManager.collect(collectParams);
    }

    function positionId() external view returns (uint256) {
        return positionTokenId;
    }
}
