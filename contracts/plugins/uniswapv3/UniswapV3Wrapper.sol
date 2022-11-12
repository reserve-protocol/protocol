// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.9;

import { IUniswapV3Wrapper } from "./IUniswapV3Wrapper.sol";
import { INonfungiblePositionManager } from "./INonfungiblePositionManager.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "hardhat/console.sol"; //TODO remove console.log

import "@uniswap/v3-periphery/contracts/libraries/TransferHelper.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import "@uniswap/v3-periphery/contracts/libraries/LiquidityAmounts.sol";
import "@uniswap/v3-core/contracts/libraries/TickMath.sol";

contract UniswapV3Wrapper is ERC20, IUniswapV3Wrapper, ReentrancyGuard {
    struct Deposit {
        uint256 tokenId;
        address token0;
        address token1;
    }

    bool isInitialized = false;
    Deposit deposit;

    //IUniswapV3Pool immutable pool;

    INonfungiblePositionManager immutable nonfungiblePositionManager =
        INonfungiblePositionManager(0xC36442b4a4522E871399CD717aBDD847Ab11FE88);

    IUniswapV3Factory immutable uniswapV3Factory =
        IUniswapV3Factory(0x1F98431c8aD98523631AE4a59f267346ea31F984);

    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mint(INonfungiblePositionManager.MintParams memory params)
        external
        returns (
            uint256 tokenId,
            uint128 liquidity,
            uint256 amount0,
            uint256 amount1
        )
    {
        require(!isInitialized, "Contract is already initialized here!");
        isInitialized = true;

        params.recipient = address(this);
        params.deadline = block.timestamp;

        TransferHelper.safeTransferFrom(
            params.token0,
            msg.sender,
            address(this),
            params.amount0Desired
        );
        TransferHelper.safeTransferFrom(
            params.token1,
            msg.sender,
            address(this),
            params.amount1Desired
        );

        TransferHelper.safeApprove(
            params.token0,
            address(nonfungiblePositionManager),
            params.amount0Desired
        );
        TransferHelper.safeApprove(
            params.token1,
            address(nonfungiblePositionManager),
            params.amount1Desired
        );

        (tokenId, liquidity, amount0, amount1) = nonfungiblePositionManager.mint(params);
        _mint(msg.sender, liquidity);

        if (amount0 < params.amount0Desired) {
            TransferHelper.safeApprove(params.token0, address(nonfungiblePositionManager), 0); //TODO why approve 0 to other direction?
            uint256 refund0 = params.amount0Desired - amount0;
            TransferHelper.safeTransfer(params.token0, msg.sender, refund0);
        }

        if (amount1 < params.amount1Desired) {
            TransferHelper.safeApprove(params.token1, address(nonfungiblePositionManager), 0);
            uint256 refund1 = params.amount1Desired - amount1;
            TransferHelper.safeTransfer(params.token1, msg.sender, refund1);
        }

        deposit.token0 = params.token0;
        deposit.token1 = params.token1;
        deposit.tokenId = tokenId;
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
        require(isInitialized, "Contract is not initialized!");

        TransferHelper.safeTransferFrom(deposit.token0, msg.sender, address(this), amount0Desired);
        TransferHelper.safeTransferFrom(deposit.token1, msg.sender, address(this), amount1Desired);

        TransferHelper.safeApprove(
            deposit.token0,
            address(nonfungiblePositionManager),
            amount0Desired
        );
        TransferHelper.safeApprove(
            deposit.token1,
            address(nonfungiblePositionManager),
            amount1Desired
        );

        INonfungiblePositionManager.IncreaseLiquidityParams memory increaseLiquidityParams;
        increaseLiquidityParams.tokenId = deposit.tokenId;
        increaseLiquidityParams.amount0Desired = amount0Desired;
        increaseLiquidityParams.amount1Desired = amount1Desired;
        increaseLiquidityParams.amount0Min = 0;
        increaseLiquidityParams.amount1Min = 0;
        increaseLiquidityParams.deadline = block.timestamp;
        (liquidity, amount0, amount1) = nonfungiblePositionManager.increaseLiquidity(
            increaseLiquidityParams
        );
        _mint(msg.sender, liquidity);
    }

    function decreaseLiquidity(uint128 liquidity)
        external
        nonReentrant
        returns (uint256 amount0, uint256 amount1)
    {
        require(isInitialized, "Contract is not initialized!");

        INonfungiblePositionManager.DecreaseLiquidityParams memory decreaseLiquidityParams;
        decreaseLiquidityParams.tokenId = deposit.tokenId;
        decreaseLiquidityParams.liquidity = liquidity;
        decreaseLiquidityParams.amount0Min = 0;
        decreaseLiquidityParams.amount1Min = 0;
        decreaseLiquidityParams.deadline = block.timestamp;
        (amount0, amount1) = nonfungiblePositionManager.decreaseLiquidity(decreaseLiquidityParams);

        INonfungiblePositionManager.CollectParams memory collectParams = INonfungiblePositionManager
            .CollectParams(deposit.tokenId, msg.sender, uint128(amount0), uint128(amount1));
        nonfungiblePositionManager.collect(collectParams);
        _burn(msg.sender, liquidity);
    }

    //TODO collect per token balance similar to /contracts/plugins/aave/StaticATokenLM.sol
    function claimRewards(address recipient)
        external
        nonReentrant
        returns (
            address token0,
            address token1,
            uint256 amount0,
            uint256 amount1
        )
    {
        require(isInitialized, "Contract is not initialized!");
        INonfungiblePositionManager.CollectParams memory collectParams = INonfungiblePositionManager
            .CollectParams(deposit.tokenId, recipient, type(uint128).max, type(uint128).max);
        (amount0, amount1) = nonfungiblePositionManager.collect(collectParams);
        return (token0, token1, amount0, amount1);
    }

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
        )
    {
        require(isInitialized, "Contract is not initialized!");
        return nonfungiblePositionManager.positions(deposit.tokenId);
    }

    function positionId() external view returns (uint256) {
        return deposit.tokenId;
    }

    function slot0()
        external
        view
        returns (
            uint160 sqrtPriceX96,
            bool unlocked,
            uint96 nonce,
            address operator,
            address token0,
            address token1,
            uint24 fee,
            int24 tickLower,
            int24 tickUpper,
            uint128 liquidity
        )
    {
        require(isInitialized, "Contract is not initialized!");

        (nonce, operator, token0, token1, fee, tickLower, tickUpper, liquidity, , , , ) = this
            .positions();

        //TODO is it cheaper than
        //PoolAddress.PoolKey({token0: params.token0, token1: params.token1, fee: params.fee})
        //PoolAddress.computeAddress(factory, poolKey);
        IUniswapV3Pool pool = IUniswapV3Pool(uniswapV3Factory.getPool(token0, token1, fee));
        (sqrtPriceX96, , , , , , unlocked) = pool.slot0();
    }

    function principal()
        external
        view
        returns (
            uint256 amount0,
            uint256 amount1,
            address token0,
            address token1
        )
    {
        uint160 sqrtRatioX96;
        int24 tickLower;
        int24 tickUpper;
        uint128 liquidity;
        (sqrtRatioX96, , , , token0, token1, , tickLower, tickUpper, liquidity) = this.slot0();

        uint160 lowerSqrtRatio = TickMath.getSqrtRatioAtTick(tickLower);
        uint160 upperSqrtRatio = TickMath.getSqrtRatioAtTick(tickUpper);

        (amount0, amount1) = LiquidityAmounts.getAmountsForLiquidity(
            sqrtRatioX96,
            lowerSqrtRatio,
            upperSqrtRatio,
            liquidity
        );
    }
}
