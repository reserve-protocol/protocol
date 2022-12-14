// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.9;

import "./UniconvexAbstractCollateral.sol";

/**
    @title Convex Curve Non Fiat Collateral
    @notice Collateral plugin for Convex+Curve Volatile Pools
    @notice Yields CRV and CVX tokens,
    @notice as well as any extra rewards the Convex+Curve pool used as collateral reserve may have,
    @notice claimable with `claimRewards`.
    @notice Trading fees are accumulated in the Curve pool and result in `refPerTok` growth.
    @author Vic G. Larson
    @author Gene A. Tsvigun
  */
contract UniconvexNonFiatCollateral is UniconvexAbstractCollateral {
    constructor(
        uint256 poolId,
        uint192 fallbackPrice_,
        AggregatorV3Interface[] memory chainlinkFeeds_,
        uint192 maxTradeVolume_,
        uint48 oracleTimeout_,
        bytes32 targetName_,
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
    {}

    function refresh() external override {
        if (alreadyDefaulted()) return;

        CollateralStatus oldStatus = status();

        uint192 referencePrice = refPerTok();
        IBooster.PoolInfo memory poolInfo = convexBooster.poolInfo(poolId);
        if (poolInfo.shutdown || referencePrice < prevReferencePrice) {
            markStatus(CollateralStatus.DISABLED);
        } else {
            try this.strictPrice() returns (uint192) {
                markStatus(CollateralStatus.SOUND);
            } catch (bytes memory errData) {
                // see: docs/solidity-style.md#Catching-Empty-Data
                if (errData.length == 0) revert(); // solhint-disable-line reason-string
                markStatus(CollateralStatus.IFFY);
            }
        }
        prevReferencePrice = referencePrice;

        CollateralStatus newStatus = status();
        if (oldStatus != newStatus) {
            emit CollateralStatusChanged(oldStatus, newStatus);
        }
    }

    /// @return {UoA/target} The price of a target unit in UoA
    function pricePerTarget() public view override returns (uint192) {
        return strictPrice();
    }
}
