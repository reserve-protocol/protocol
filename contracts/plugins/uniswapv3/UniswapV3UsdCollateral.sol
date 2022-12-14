// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.9;

import "@uniswap/v3-core/contracts/libraries/FixedPoint96.sol";
import "@uniswap/v3-core/contracts/libraries/TickMath.sol";

import "@openzeppelin/contracts/utils/math/Math.sol";

import "hardhat/console.sol";
import "contracts/libraries/Fixed.sol";

import "./IUniswapV3Wrapper.sol";
import "./UniswapV3Collateral.sol";

/**
    @title Uniswap V3 USD Collateral
    @notice Collateral plugin for non-fiat Uniswap V3 positions
    @notice Requires Uniswap V3 Wrapper to be deployed first to wrap the position used
    @author Gene A. Tsvigun
    @author Vic G. Larson
  */
contract UniswapV3UsdCollateral is UniswapV3Collateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    int24 public immutable lowTickThreshold;
    int24 public immutable highTickThreshold;
    uint192 public immutable defaultThreshold;

    /**
     * @param tickThreshold_ max acceptable absolute value of difference with Uniswap pool tick
     * 10 means ~0.1%, 100 means ~1% price difference from the optimum 1:1 pool state
     */
    constructor(
        uint192 fallbackPrice_,
        uint192 fallbackPriceSecondAsset_,
        AggregatorV3Interface chainlinkFeed_,
        AggregatorV3Interface chainlinkFeedSecondAsset_,
        IUniswapV3Wrapper uniswapV3Wrapper_,
        uint192 maxTradeVolume_,
        uint48 oracleTimeout_,
        bytes32 targetName_,
        uint192 defaultThreshold_,
        uint24 tickThreshold_,
        uint256 delayUntilDefault_
    )
        UniswapV3Collateral(
            fallbackPrice_,
            fallbackPriceSecondAsset_,
            chainlinkFeed_,
            chainlinkFeedSecondAsset_,
            uniswapV3Wrapper_,
            maxTradeVolume_,
            oracleTimeout_,
            targetName_,
            delayUntilDefault_
        )
    {
        require(defaultThreshold_ > 0, "UniswapV3UsdCollateral: defaultThreshold can't be zero");
        defaultThreshold = defaultThreshold_;
        // tick representing the balanced state of the pool
        int24 zeroTick = _zeroTick(underlyingERC20Decimals0, underlyingERC20Decimals1);
        lowTickThreshold = zeroTick - int24(tickThreshold_);
        highTickThreshold = zeroTick + int24(tickThreshold_);
    }

    /// Refresh exchange rates and update default status.
    function refresh() external virtual override {
        if (alreadyDefaulted()) return;
        CollateralStatus oldStatus = status();

        CollateralStatus newStatus = poolAwayFromOptimalPoint() || pricesAwayFromPegOrUnknown()
            ? CollateralStatus.IFFY
            : CollateralStatus.SOUND;

        if (oldStatus != newStatus) {
            emit CollateralStatusChanged(oldStatus, newStatus);
        }
        markStatus(newStatus);
    }

    /// @return {target/ref} Quantity of whole target units per whole reference unit in the peg
    /// {target} = {UoA} and {ref} = {tok}
    /// The same as strictPrice when price of assets equal to pricePerTarget()
    function targetPerRef() public view override returns (uint192) {
        return
            uint192(
                (FIX_ONE * 10 ** 18 * 2) /
                    Math.sqrt(10 ** (underlyingERC20Decimals0 + underlyingERC20Decimals1))
            );
    }

    /**
     * @notice Check if the current tick value the Uniswap pool
     * @notice in which the wrapped position is opened
     * @notice is within bounds
     * @dev the point of comparing ticks instead of calculating price deviation
     * @dev from price values is that price values are calculated
     * @dev the tick value which is already stored in `pool.slot0`
     */
    function poolAwayFromOptimalPoint() internal view returns (bool) {
        int24 tick = IUniswapV3Wrapper(address(erc20)).tick();
        return tick < lowTickThreshold || tick > highTickThreshold;
    }

    /**
     * @notice Check if both prices are available to get from the feed
     * @notice and if they are within bounds
     */
    function pricesAwayFromPegOrUnknown() internal view returns (bool) {
        uint192 peg = pricePerTarget();
        uint192 delta = (peg * defaultThreshold) / FIX_ONE;
        return
            priceOutOfBoundsOrUnknown(chainlinkFeed, peg, delta) ||
            priceOutOfBoundsOrUnknown(chainlinkFeedSecondAsset, peg, delta);
    }

    /**
     * @notice Check if the price is available to get from the feed
     * @notice and if it is within bounds
     * @param feed Price feed to get the price from
     * @param peg center of the acceptable price bounds
     * @param delta radius of the acceptable price bounds
     */
    function priceOutOfBoundsOrUnknown(
        AggregatorV3Interface feed,
        uint192 peg,
        uint192 delta
    ) internal view returns (bool) {
        try feed.price_(oracleTimeout) returns (uint192 price) {
            if (price < peg - delta || price > peg + delta) {
                return true;
            }
        } catch (bytes memory errData) {
            if (errData.length == 0) revert();
            return true;
        }
        return false;
    }

    /**
        @notice calculates the tick representing token0Price of the balanced state of the pool
        @dev https://docs.uniswap.org/contracts/v3/reference/core/interfaces/pool/IUniswapV3PoolState#slot0
        @dev Pool balance boundaries can be expressed with ticks, since that math is already done in Uniswap
        @dev tick = log(token0Price, 1.0001)
        @dev Tick is around 0 when the pool is balanced and prices are close to 1
        @dev and further from 0 when prices are further from 1, like 1.001 ** 100 = 1.105115697720756, 
        @dev i.e. tick value 100 means that there's ~1.1 times more of token1 than of token0 in the pool.
        @dev The above is true for the case when both tokens have the same decimals.
        @dev for DAI/USDT equal amounts of DAI and USDT will result in 
        @dev token0Price = 10 ** (-12)
        @dev log(10 ** 12, 1.0001) ~= 276324.0264 ~= 276324
        @dev so 276324 is a good value to represent the balanced state
        @dev and +-100 results in the same ~1.1 price disbalance
        @dev 1.0001 ** (-276324 + 100) * 10 ** 12 ~= 1.01005
        @dev 1.0001 ** (-276324 - 100) * 10 ** 12 ~= 0.99005
        @param decimals0 decimals of token0 of the pool
        @param decimals1 decimals of token1 of the pool 
    */
    function _zeroTick(uint8 decimals0, uint8 decimals1) internal pure returns (int24) {
        int8 decimalsDiff = int8(decimals0) - int8(decimals1);
        uint8 absDecimalsDiff = decimalsDiff < 0 ? uint8(-decimalsDiff) : uint8(decimalsDiff);
        uint256 decimalsMultiplier = Math.sqrt(10 ** absDecimalsDiff);
        uint256 price = FixedPoint96.Q96;
        if (decimalsDiff > 0) {
            price /= decimalsMultiplier;
        } else price *= decimalsMultiplier;

        return TickMath.getTickAtSqrtRatio(uint160(price));
    }
}
