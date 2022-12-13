// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.9;

import "./UniconvexAbstractCollateral.sol";
import "hardhat/console.sol";

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
    function poolIsAwayFromOptimalPoint(uint192 peg, uint192 delta) internal view returns (bool) {
        console.log("peg", peg);
        console.log("delta", delta);
        console.log("dy", curvePool.get_dy(0, 1, FIX_ONE));
        console.log("dy", curvePool.get_dy(0, 2, FIX_ONE));
        uint256 multiplier = 10 ** IERC20Metadata(this.coins(0)).decimals();
        for (uint256 i = 1; i < chainlinkFeeds.length; i++) {
            uint256 divider = 10 ** IERC20Metadata(this.coins(i)).decimals();
            uint256 p = (multiplier * curvePool.get_dy(0, int128(uint128(i)), FIX_ONE)) / divider;
            console.log("p", p);
            if (p < peg - delta || p > peg + delta) {
                console.log("bad");
                return true;
            }
        }
        console.log("good");
        return false;
    }

    function priceOutOfBoundsOrUnknown(
        AggregatorV3Interface feed,
        uint192 peg,
        uint192 delta
    ) internal view returns (bool) {
        try feed.price_(oracleTimeout) returns (uint192 p) {
            if (p < peg - delta || p > peg + delta) {
                console.log("priceOutOfBoundsOrUnknown", p, peg, delta);
                return true;
            }
        } catch (bytes memory errData) {
            if (errData.length == 0) revert();
            return true;
        }
        console.log("goodPrice");
        return false;
    }

    function refresh() external override {
        if (alreadyDefaulted()) return;

        CollateralStatus oldStatus = status();
        console.log("oldStatus", oldStatus == CollateralStatus.SOUND ? 0 : 1);

        uint192 referencePrice = refPerTok();
        if (referencePrice < prevReferencePrice) {
            markStatus(CollateralStatus.DISABLED);
        } else {
            uint192 peg = (pricePerTarget() * targetPerRef()) / FIX_ONE;
            uint192 delta = (peg * defaultThreshold) / FIX_ONE;
            bool _priceOutOfBoundsOrUnknown;
            for (uint256 i = 0; i < chainlinkFeeds.length; i++) {
                if (priceOutOfBoundsOrUnknown(chainlinkFeeds[i], peg, delta)) {
                    _priceOutOfBoundsOrUnknown = true;
                    break;
                }
            }
            (_priceOutOfBoundsOrUnknown || poolIsAwayFromOptimalPoint(peg, delta))
                ? markStatus(CollateralStatus.IFFY)
                : markStatus(CollateralStatus.SOUND);
        }
        prevReferencePrice = referencePrice;

        CollateralStatus newStatus = status();
        console.log("newStatus", newStatus == CollateralStatus.SOUND ? 0 : 1);
        if (oldStatus != newStatus) {
            emit CollateralStatusChanged(oldStatus, newStatus);
        }
    }
}
