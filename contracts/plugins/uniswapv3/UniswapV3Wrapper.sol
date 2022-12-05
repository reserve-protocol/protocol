// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol";
import "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import "@uniswap/v3-core/contracts/libraries/TickMath.sol";

import "@uniswap/v3-periphery/contracts/interfaces/INonfungiblePositionManager.sol";
import "@uniswap/v3-periphery/contracts/libraries/LiquidityAmounts.sol";
import "@uniswap/v3-periphery/contracts/libraries/PositionValue.sol";
import "@uniswap/v3-periphery/contracts/libraries/SqrtPriceMathPartial.sol";
import "@uniswap/v3-periphery/contracts/libraries/TransferHelper.sol";

import "./IUniswapV3Wrapper.sol";
import "./RewardSplitter.sol";

/**
    @title Uniswap V3 Wrapper
    @notice ERC20 Wrapper token for Uniswap V3 positions,
    @notice representing ERC721 NFT positions as ERC20 tokens with pro rata rewards sharing
    @author Gene A. Tsvigun
    @author Vic G. Larson
  */
contract UniswapV3Wrapper is IUniswapV3Wrapper, RewardSplitter, ReentrancyGuard {
    // UniswapV3 position NFT id
    uint256 public immutable tokenId;
    // Underlying assets provided as liquidity by whoever mints the wrapper token
    address public immutable token0;
    address public immutable token1;

    // https://docs.uniswap.org/contracts/v3/reference/deployments
    // NonfungiblePositionManager Ethereum Mainnet Address
    INonfungiblePositionManager internal immutable nonfungiblePositionManager =
        INonfungiblePositionManager(0xC36442b4a4522E871399CD717aBDD847Ab11FE88);
    // UniswapV3Factory Ethereum Mainnet Address
    IUniswapV3Factory internal immutable uniswapV3Factory =
        IUniswapV3Factory(0x1F98431c8aD98523631AE4a59f267346ea31F984);
    IUniswapV3Pool public immutable pool;

    constructor(
        string memory name_,
        string memory symbol_,
        INonfungiblePositionManager.MintParams memory params,
        // the address holding both assets, can be same as deployer
        address liquidityProvider
    ) ERC20(name_, symbol_) RewardSplitter(params.token0, params.token1) {
        token0 = params.token0;
        token1 = params.token1;

        pool = IUniswapV3Pool(uniswapV3Factory.getPool(token0, token1, params.fee));

        params.recipient = address(this);
        params.deadline = block.timestamp;

        // transfer both token ammounts to self from the liquidity provider
        TransferHelper.safeTransferFrom(
            params.token0,
            liquidityProvider,
            address(this),
            params.amount0Desired
        );
        TransferHelper.safeTransferFrom(
            params.token1,
            liquidityProvider,
            address(this),
            params.amount1Desired
        );

        // approve both tokens to be taken by Uniswap
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

        (
            uint256 _tokenId,
            uint128 liquidity,
            uint256 amount0,
            uint256 amount1
        ) = nonfungiblePositionManager.mint(params);
        tokenId = _tokenId;
        _mint(msg.sender, liquidity);
        emit IncreaseWrappedLiquidity(tokenId, liquidity, amount0, amount1);
        _refund(params.amount0Desired, params.amount1Desired, amount0, amount1, liquidityProvider);
    }

    // TODO put amount0Min, amount1Min, and deadline back to the params list
    /// @notice Increases the amount of liquidity in the wrapped position, with wrapper tokens paid by the `msg.sender`
    /// @param amount0Desired The desired amount of token0 to be spent
    /// @param amount1Desired The desired amount of token1 to be spent,
    /// amount0Min The minimum amount of token0 to spend, which serves as a slippage check,
    /// amount1Min The minimum amount of token1 to spend, which serves as a slippage check,
    /// deadline The time by which the transaction must be included to effect the change
    /// @return liquidity The new liquidity amount as a result of the increase
    /// @return amount0 The amount of token0 used to acheive resulting liquidity
    /// @return amount1 The amount of token1 used to acheive resulting liquidity
    function increaseLiquidity(uint256 amount0Desired, uint256 amount1Desired)
        external
        nonReentrant
        returns (
            uint128 liquidity,
            uint256 amount0,
            uint256 amount1
        )
    {
        TransferHelper.safeTransferFrom(token0, msg.sender, address(this), amount0Desired);
        TransferHelper.safeTransferFrom(token1, msg.sender, address(this), amount1Desired);

        TransferHelper.safeApprove(token0, address(nonfungiblePositionManager), amount0Desired);
        TransferHelper.safeApprove(token1, address(nonfungiblePositionManager), amount1Desired);

        INonfungiblePositionManager.IncreaseLiquidityParams memory increaseLiquidityParams;
        increaseLiquidityParams.tokenId = tokenId;
        increaseLiquidityParams.amount0Desired = amount0Desired;
        increaseLiquidityParams.amount1Desired = amount1Desired;
        increaseLiquidityParams.amount0Min = 0;
        increaseLiquidityParams.amount1Min = 0;
        increaseLiquidityParams.deadline = block.timestamp;
        (liquidity, amount0, amount1) = nonfungiblePositionManager.increaseLiquidity(
            increaseLiquidityParams
        );
        _mint(msg.sender, liquidity);
        emit IncreaseWrappedLiquidity(tokenId, liquidity, amount0, amount1);
        _refund(amount0Desired, amount1Desired, amount0, amount1, msg.sender);
    }

    /// @notice Decreases the amount of liquidity in the wrapped position and accounts it to the `msg.sender`
    /// @param liquidity The amount by which liquidity will be decreased
    /// amount0Min The minimum amount of token0 that should be accounted for the burned liquidity,
    /// amount1Min The minimum amount of token1 that should be accounted for the burned liquidity,
    /// deadline The time by which the transaction must be included to effect the change
    /// @return amount0 The amount of token0 accounted to the position's tokens owed
    /// @return amount1 The amount of token1 accounted to the position's tokens owed
    function decreaseLiquidity(uint128 liquidity)
        external
        nonReentrant
        returns (uint256 amount0, uint256 amount1)
    {
        INonfungiblePositionManager.DecreaseLiquidityParams memory decreaseLiquidityParams;
        decreaseLiquidityParams.tokenId = tokenId;
        decreaseLiquidityParams.liquidity = liquidity;
        decreaseLiquidityParams.amount0Min = 0;
        decreaseLiquidityParams.amount1Min = 0;
        decreaseLiquidityParams.deadline = block.timestamp;
        (amount0, amount1) = nonfungiblePositionManager.decreaseLiquidity(decreaseLiquidityParams);

        INonfungiblePositionManager.CollectParams memory collectParams = INonfungiblePositionManager
            .CollectParams(tokenId, msg.sender, uint128(amount0), uint128(amount1));
        nonfungiblePositionManager.collect(collectParams);
        _burn(msg.sender, liquidity);
        emit DecreaseWrappedLiquidity(tokenId, liquidity, amount0, amount1);
    }

    /**
     * @notice Collects up to a maximum amount of fees owed by the holder of the wrapper token
     * @notice calculated from the following values:
     * @notice * all the fees ever acquired by the wrapped position
     * @notice * balance history of the wrapper token holder (`msg.sender`) so far
     * @notice * how much the wrapper token holder (`msg.sender`) was already paid
     * @param recipient the recipient of the fees owed to `msg.sender`
     * @return token0 first token address
     * @return token1 second token address
     * @return amount0 The amount of fees paid in token0
     * @return amount1 The amount of fees paid in token1
     */
    function claimRewards(address recipient)
        external
        nonReentrant
        returns (
            address,
            address,
            uint256,
            uint256
        )
    {
        (
            address[MAX_TOKENS] memory tokens,
            uint256[MAX_TOKENS] memory amounts
        ) = _claimRewardsShareTo(recipient);
        return (tokens[0], tokens[1], amounts[0], amounts[1]);
    }

    /**
     * @notice called when there's 0 liquidity wrapped to calculate the price of it
     * @notice answers the question "how much of each token would it cost to acquire some liquitity"
     */
    function priceSimilarPosition()
        external
        view
        returns (
            uint256 amount0,
            uint256 amount1,
            uint128 liquidity
        )
    {
        liquidity = uint128(
            10**Math.max(IERC20Metadata(token0).decimals(), IERC20Metadata(token1).decimals())
        );
        (uint160 sqrtRatioX96, int24 tick, , , , , ) = pool.slot0();
        (, , , , , int24 tickLower, int24 tickUpper, , , , , ) = nonfungiblePositionManager
            .positions(tokenId);

        if (tick < tickLower) {
            // current tick is below the passed range; liquidity can only become in range by crossing from left to
            // right, when we'll need _more_ token0 (it's becoming more valuable) so user must provide it
            amount0 = uint256(
                SqrtPriceMathPartial.getAmount0Delta(
                    TickMath.getSqrtRatioAtTick(tickLower),
                    TickMath.getSqrtRatioAtTick(tickUpper),
                    liquidity,
                    true
                )
            );
            amount1 = 0;
        } else if (tick < tickUpper) {
            amount0 = uint256(
                SqrtPriceMathPartial.getAmount0Delta(
                    sqrtRatioX96,
                    TickMath.getSqrtRatioAtTick(tickUpper),
                    liquidity,
                    true
                )
            );
            amount1 = uint256(
                SqrtPriceMathPartial.getAmount1Delta(
                    TickMath.getSqrtRatioAtTick(tickLower),
                    sqrtRatioX96,
                    liquidity,
                    true
                )
            );
        } else {
            // current tick is above the passed range; liquidity can only become in range by crossing from right to
            // left, when we'll need _more_ token1 (it's becoming more valuable) so user must provide it
            amount0 = 0;
            amount1 = uint256(
                SqrtPriceMathPartial.getAmount1Delta(
                    TickMath.getSqrtRatioAtTick(tickLower),
                    TickMath.getSqrtRatioAtTick(tickUpper),
                    liquidity,
                    true
                )
            );
        }
    }

    /**
     * @notice Calculates the principal (currently acting as liquidity) locked in this wrapper
     */
    function principal() external view returns (uint256 amount0, uint256 amount1) {
        (uint160 sqrtRatioX96, , , , , , ) = pool.slot0();
        (amount0, amount1) = PositionValue.principal(
            nonfungiblePositionManager,
            tokenId,
            sqrtRatioX96
        );
    }

    /**
     * @notice Calculates the total fees accumulated in the wrapped position
     * @return amounts The amount of fees owed in both tokens
     */
    function _freshRewards() internal view virtual override returns (uint256[2] memory amounts) {
        (amounts[0], amounts[1]) = PositionValue.fees(nonfungiblePositionManager, tokenId);
    }

    /**
     * @notice Collects up to a maximum amount of fees owed by the wrapped position to the wrapper
     * @return amounts The amount of fees collected in both tokens
     */
    function _collectRewards() internal virtual override returns (uint256[2] memory amounts) {
        INonfungiblePositionManager.CollectParams memory collectParams = INonfungiblePositionManager
            .CollectParams(tokenId, address(this), type(uint128).max, type(uint128).max);
        (amounts[0], amounts[1]) = nonfungiblePositionManager.collect(collectParams);
    }

    /**
     * @notice Refund the amounts that did not go to the pool on `increaseLiquidity` called
     * @notice and cleanup leftover allowances
     * @param amount0Desired The amount of token0 indended to be spent
     * @param amount1Desired The amount of token1 indended to be spent
     * @param amount0 The amount of token0 actually spent
     * @param amount1 The amount of token1 actually spent
     * @param recipient The recpipent of the refund
     */
    function _refund(
        uint256 amount0Desired,
        uint256 amount1Desired,
        uint256 amount0,
        uint256 amount1,
        address recipient
    ) internal {
        if (amount0 < amount0Desired) {
            TransferHelper.safeApprove(token0, address(nonfungiblePositionManager), 0);
            uint256 refund0 = amount0Desired - amount0;
            TransferHelper.safeTransfer(token0, recipient, refund0);
        }

        if (amount1 < amount1Desired) {
            TransferHelper.safeApprove(token1, address(nonfungiblePositionManager), 0);
            uint256 refund1 = amount1Desired - amount1;
            TransferHelper.safeTransfer(token1, recipient, refund1);
        }
    }
}
