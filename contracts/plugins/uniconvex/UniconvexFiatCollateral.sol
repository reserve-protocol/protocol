// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.9;

import "./UniconvexAbstractCollateral.sol";

contract UniconvexFiatCollateral is UniconvexAbstractCollateral {
    using OracleLib for AggregatorV3Interface;
    uint192 public immutable defaultThreshold;

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
        require(defaultThreshold_ > 0, "defaultThreshold zero");
        defaultThreshold = defaultThreshold_;
    }

    //TODO implement
    function poolIsAwayFromOptimalPoint() internal pure returns (bool) {
        return true;
    }

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

    function refresh() external override {
        if (alreadyDefaulted()) return;

        CollateralStatus oldStatus = status();

        uint192 referencePrice = refPerTok();
        if (referencePrice < prevReferencePrice) {
            markStatus(CollateralStatus.DISABLED);
        } else {
            uint192 peg = (pricePerTarget() * targetPerRef()) / FIX_ONE;
            uint192 delta = (peg * defaultThreshold) / FIX_ONE;
            for (uint256 i = 0; i < chainlinkFeeds.length; i++) {
                if (priceOutOfBoundsOrUnknown(chainlinkFeeds[i], peg, delta)) {
                    markStatus(CollateralStatus.IFFY);
                    break;
                }
            }
            if (poolIsAwayFromOptimalPoint()) {
                markStatus(CollateralStatus.IFFY);
            }
        }
        prevReferencePrice = referencePrice;

        CollateralStatus newStatus = status();
        if (oldStatus != newStatus) {
            emit DefaultStatusChanged(oldStatus, newStatus);
        }
    }
}
