// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.9;

import {IUniswapV3Wrapper} from "./IUniswapV3Wrapper.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "hardhat/console.sol"; //TODO remove console.log

import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import "@uniswap/v3-periphery/contracts/interfaces/INonfungiblePositionManager.sol";

import "@uniswap/v3-core/contracts/libraries/TickMath.sol";
import "@uniswap/v3-core/contracts/libraries/SqrtPriceMath.sol";
import "@uniswap/v3-periphery/contracts/libraries/LiquidityAmounts.sol";
import "@uniswap/v3-periphery/contracts/libraries/PositionValue.sol";
import "@uniswap/v3-periphery/contracts/libraries/TransferHelper.sol";
import "./RewardSplitter.sol";

/**
    @title Uniswap V3 Wrapper
    @notice ERC20 Wrapper token for Uniswap V3 positions
    @author Gene A. Tsvigun
    @author Vic G. Larson
  */
contract UniswapV3Wrapper is IUniswapV3Wrapper, RewardSplitter, ReentrancyGuard {
    uint256 internal _tokenId; //TODO: make immutable
    address internal immutable _token0;
    address internal immutable _token1;

    INonfungiblePositionManager immutable nonfungiblePositionManager =
        INonfungiblePositionManager(0xC36442b4a4522E871399CD717aBDD847Ab11FE88);

    IUniswapV3Factory immutable uniswapV3Factory = IUniswapV3Factory(0x1F98431c8aD98523631AE4a59f267346ea31F984);
    IUniswapV3Pool pool;

    constructor(
        string memory name_,
        string memory symbol_,
        INonfungiblePositionManager.MintParams memory params,
        address liquidityProvider
    ) ERC20(name_, symbol_) RewardSplitter(_tokenArray(params)) {
        _token0 = params.token0;
        _token1 = params.token1;
        _mint(params, liquidityProvider);
    }

    function _mint(INonfungiblePositionManager.MintParams memory params, address liquidityProvider)
        internal
        returns (
            uint256 tokenId,
            uint128 liquidity,
            uint256 amount0,
            uint256 amount1
        )
    {
        pool = IUniswapV3Pool(uniswapV3Factory.getPool(_token0, _token1, params.fee));

        params.recipient = address(this);
        params.deadline = block.timestamp;

        TransferHelper.safeTransferFrom(params.token0, liquidityProvider, address(this), params.amount0Desired);
        TransferHelper.safeTransferFrom(params.token1, liquidityProvider, address(this), params.amount1Desired);

        TransferHelper.safeApprove(params.token0, address(nonfungiblePositionManager), params.amount0Desired);
        TransferHelper.safeApprove(params.token1, address(nonfungiblePositionManager), params.amount1Desired);

        (tokenId, liquidity, amount0, amount1) = nonfungiblePositionManager.mint(params);
        _mint(msg.sender, liquidity);

        if (amount0 < params.amount0Desired) {
            TransferHelper.safeApprove(params.token0, address(nonfungiblePositionManager), 0);
            uint256 refund0 = params.amount0Desired - amount0;
            TransferHelper.safeTransfer(params.token0, liquidityProvider, refund0);
        }

        if (amount1 < params.amount1Desired) {
            TransferHelper.safeApprove(params.token1, address(nonfungiblePositionManager), 0);
            uint256 refund1 = params.amount1Desired - amount1;
            TransferHelper.safeTransfer(params.token1, liquidityProvider, refund1);
        }

        _tokenId = tokenId;
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
        TransferHelper.safeTransferFrom(_token0, msg.sender, address(this), amount0Desired);
        TransferHelper.safeTransferFrom(_token1, msg.sender, address(this), amount1Desired);

        TransferHelper.safeApprove(_token0, address(nonfungiblePositionManager), amount0Desired);
        TransferHelper.safeApprove(_token1, address(nonfungiblePositionManager), amount1Desired);

        INonfungiblePositionManager.IncreaseLiquidityParams memory increaseLiquidityParams;
        increaseLiquidityParams.tokenId = _tokenId;
        increaseLiquidityParams.amount0Desired = amount0Desired;
        increaseLiquidityParams.amount1Desired = amount1Desired;
        increaseLiquidityParams.amount0Min = 0;
        increaseLiquidityParams.amount1Min = 0;
        increaseLiquidityParams.deadline = block.timestamp;
        (liquidity, amount0, amount1) = nonfungiblePositionManager.increaseLiquidity(increaseLiquidityParams);
        _mint(msg.sender, liquidity);
    }

    function decreaseLiquidity(uint128 liquidity) external nonReentrant returns (uint256 amount0, uint256 amount1) {
        INonfungiblePositionManager.DecreaseLiquidityParams memory decreaseLiquidityParams;
        decreaseLiquidityParams.tokenId = _tokenId;
        decreaseLiquidityParams.liquidity = liquidity;
        decreaseLiquidityParams.amount0Min = 0;
        decreaseLiquidityParams.amount1Min = 0;
        decreaseLiquidityParams.deadline = block.timestamp;
        (amount0, amount1) = nonfungiblePositionManager.decreaseLiquidity(decreaseLiquidityParams);

        INonfungiblePositionManager.CollectParams memory collectParams = INonfungiblePositionManager.CollectParams(
            _tokenId,
            msg.sender,
            uint128(amount0),
            uint128(amount1)
        );
        nonfungiblePositionManager.collect(collectParams);
        _burn(msg.sender, liquidity);
    }

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
        (address[MAX_TOKENS] memory tokens, uint256[MAX_TOKENS] memory amounts) = _claimRewardsShareTo(recipient);
        return (tokens[0], tokens[1], amounts[0], amounts[1]);
    }

    function positionId() external view returns (uint256) {
        return _tokenId;
    }

    function max(uint8 a, uint8 b) internal pure returns (uint8) {
        return a >= b ? a : b;
    }

    function priceSimilarPosition()
        external
        view
        returns (
            address token0,
            address token1,
            uint256 amount0,
            uint256 amount1,
            uint128 liquidity
        )
    {
        token0 = _rewardsTokens[0];
        token1 = _rewardsTokens[1];
        liquidity = uint128(10**max(IERC20Metadata(token0).decimals(), IERC20Metadata(token1).decimals()));
        (uint160 sqrtRatioX96, int24 tick, , , , , ) = pool.slot0();
        (, , , , , int24 tickLower, int24 tickUpper, , , , , ) = nonfungiblePositionManager.positions(_tokenId);

        if (tick < tickLower) {
            // current tick is below the passed range; liquidity can only become in range by crossing from left to
            // right, when we'll need _more_ token0 (it's becoming more valuable) so user must provide it
            amount0 = uint256(
                SqrtPriceMath.getAmount0Delta(
                    TickMath.getSqrtRatioAtTick(tickLower),
                    TickMath.getSqrtRatioAtTick(tickUpper),
                    int128(liquidity)
                )
            );
        } else if (tick < tickUpper) {
            amount0 = uint256(
                SqrtPriceMath.getAmount0Delta(sqrtRatioX96, TickMath.getSqrtRatioAtTick(tickUpper), int128(liquidity))
            );
            amount1 = uint256(
                SqrtPriceMath.getAmount1Delta(TickMath.getSqrtRatioAtTick(tickLower), sqrtRatioX96, int128(liquidity))
            );
        } else {
            // current tick is above the passed range; liquidity can only become in range by crossing from right to
            // left, when we'll need _more_ token1 (it's becoming more valuable) so user must provide it
            amount1 = uint256(
                SqrtPriceMath.getAmount1Delta(
                    TickMath.getSqrtRatioAtTick(tickLower),
                    TickMath.getSqrtRatioAtTick(tickUpper),
                    int128(liquidity)
                )
            );
        }
    }

    function principal()
        external
        view
        returns (
            address token0,
            address token1,
            uint256 amount0,
            uint256 amount1
        )
    {
        (uint160 sqrtRatioX96, , , , , , ) = pool.slot0();
        (amount0, amount1) = PositionValue.principal(nonfungiblePositionManager, _tokenId, sqrtRatioX96);
        token0 = _rewardsTokens[0];
        token1 = _rewardsTokens[1];
    }

    function _freshRewards() internal view virtual override returns (uint256[2] memory amounts) {
        (amounts[0], amounts[1]) = PositionValue.fees(nonfungiblePositionManager, _tokenId);
    }

    function _collectRewards() internal virtual override returns (uint256[2] memory amounts) {
        INonfungiblePositionManager.CollectParams memory collectParams = INonfungiblePositionManager.CollectParams(
            _tokenId,
            address(this),
            type(uint128).max,
            type(uint128).max
        );
        (amounts[0], amounts[1]) = nonfungiblePositionManager.collect(collectParams);
    }

    function _tokenArray(INonfungiblePositionManager.MintParams memory p) internal pure returns (address[] memory arr) {
        arr = new address[](2);
        arr[0] = p.token0;
        arr[1] = p.token1;
    }
}
