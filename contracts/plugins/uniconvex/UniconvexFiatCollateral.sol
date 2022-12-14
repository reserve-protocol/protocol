// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.9;

import "./UniconvexAbstractCollateral.sol";
import "hardhat/console.sol";

/**
    @title Convex Curve Fiat Collateral
    @notice Collateral plugin for Convex+Curve Stable Pools with only USD pegged assets
    @notice Yields CRV and CVX tokens,
    @notice as well as any extra rewards the Convex+Curve pool used as collateral reserve may have,
    @notice claimable with `claimRewards`.
    @notice Trading fees are accumulated in the Curve pool and result in `refPerTok` growth.
    @author Vic G. Larson
    @author Gene A. Tsvigun
  */
contract UniconvexFiatCollateral is UniconvexAbstractCollateral {
    using OracleLib for AggregatorV3Interface;
    // maximum deviation from the reference price for any of the assets in the Curve pool
    uint192 public immutable defaultThreshold;

    /**
        @notice Constructor
        @param poolId Convex pool ID
        @param fallbackPrice_ Fallback price for the collateral asset
        @param chainlinkFeeds_ Price feeds for Curve pool assets
        @param maxTradeVolume_ Max RToken trade volume
        @param oracleTimeout_ Oracle timeout used for price feeds interaction
        @param targetName_ { target } Target name
        @param delayUntilDefault_ Delay until default
        @param defaultThreshold_ Maximum deviation from the reference price for any of the assets in the Curve pool
      */
    constructor(
        uint256 poolId,
        uint192 fallbackPrice_,
        AggregatorV3Interface[] memory chainlinkFeeds_,
        uint192 maxTradeVolume_,
        uint48 oracleTimeout_,
        bytes32 targetName_,
        uint192 defaultThreshold_,
        uint256 delayUntilDefault_
    )
        UniconvexAbstractCollateral(
            poolId,
            fallbackPrice_,
            chainlinkFeeds_,
            maxTradeVolume_,
            oracleTimeout_,
            targetName_,
            delayUntilDefault_
        )
    {
        require(defaultThreshold_ > 0, "UniconvexFiatCollateral: defaultThreshold can't be zero");
        defaultThreshold = defaultThreshold_;
    }

    /**
     * @notice Check if every ratio x0 / xi is within the allowed range,
     * @notice where x0 is the reference price and xi one of the other assets prices
     * @param peg The reference price
     * @param delta price deviation threshold
     * @return false if any ratio is outside the allowed range, true otherwise
     */
    function poolIsAwayFromOptimalPoint(uint192 peg, uint192 delta) internal view returns (bool) {
        uint256 multiplier = 10 ** IERC20Metadata(this.coins(0)).decimals();
        for (uint256 i = 1; i < chainlinkFeeds.length; i++) {
            uint256 divisor = 10 ** IERC20Metadata(this.coins(i)).decimals();
            uint256 p = (multiplier * curvePool.get_dy(0, int128(uint128(i)), FIX_ONE)) / divisor;
            if (p < peg - delta || p > peg + delta) {
                return true;
            }
        }
        return false;
    }

    /// Refresh exchange rates and update default status.
    function refresh() external override {
        if (alreadyDefaulted()) return;

        CollateralStatus oldStatus = status();

        uint192 referencePrice = refPerTok();

        IBooster.PoolInfo memory poolInfo = convexBooster.poolInfo(poolId);
        if (poolInfo.shutdown) {
            markStatus(CollateralStatus.DISABLED);
        } else if (referencePrice < prevReferencePrice) {
            markStatus(CollateralStatus.DISABLED);
        } else {
            // peg = FIX_ONE for {target} = {UoA}, not hardcoded because it can be overridden in
            // a collateral contract meant for {target} = {UoA}, where `targetPerRef` will be different from 1
            uint192 peg = pricePerTarget() / FIX_ONE;
            uint192 delta = (peg * defaultThreshold) / FIX_ONE;

            anyPriceOutOfBoundsOrUnknown(peg, delta) || poolIsAwayFromOptimalPoint(peg, delta)
                ? markStatus(CollateralStatus.IFFY)
                : markStatus(CollateralStatus.SOUND);
        }
        prevReferencePrice = referencePrice;

        CollateralStatus newStatus = status();
        if (oldStatus != newStatus) {
            emit CollateralStatusChanged(oldStatus, newStatus);
        }
    }

    /**
     * @notice Check if every price is accessible from its feed and is within the allowed range
     * @param peg The reference price
     * @param delta price deviation threshold
     * @return true if every price is accessible and within the allowed range, false otherwise
     */
    function anyPriceOutOfBoundsOrUnknown(uint192 peg, uint192 delta) internal view returns (bool) {
        for (uint256 i = 0; i < chainlinkFeeds.length; i++) {
            if (priceOutOfBoundsOrUnknown(chainlinkFeeds[i], peg, delta)) {
                return true;
            }
        }
        return false;
    }

    /**
     * @notice Check if price is accessible from the feed and is within the allowed range
     * @param feed Chainlink feed
     * @param peg The reference price
     * @param delta price deviation threshold
     * @return true if the price is accessible and within the allowed range, false otherwise
     */
    function priceOutOfBoundsOrUnknown(
        AggregatorV3Interface feed,
        uint192 peg,
        uint192 delta
    ) internal view returns (bool) {
        try feed.price_(oracleTimeout) returns (uint192 p) {
            if (p < peg - delta || p > peg + delta) {
                return true;
            }
        } catch (bytes memory errData) {
            if (errData.length == 0) revert();
            return true;
        }
        return false;
    }
}
