// SPDX-License-Identifier: agpl-3.0

// done as part of a reserver-protocol hackathon
pragma solidity ^0.8.9;

import "./UniswapV2AbstractCollateral.sol";
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol";
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol";
import "hardhat/console.sol";


contract UniswapV2FiatCollateral is UniswapV2AbstractCollateral {
    using OracleLib for AggregatorV3Interface;

    uint192 public immutable defaultThreshold;

    constructor(
        uint192 fallbackPrice_,
        AggregatorV3Interface chainlinkFeed_,
        AggregatorV3Interface chainlinkFeedSecondAsset_,
        IUniswapV2Pair erc20_,
        uint192 maxTradeVolume_,
        uint48 oracleTimeout_,
        bytes32 targetName_,
        uint192 defaultThreshold_,
        uint256 delayUntilDefault_
    )
        UniswapV2AbstractCollateral(
            fallbackPrice_,
            chainlinkFeed_,
            chainlinkFeedSecondAsset_,
            erc20_,
            maxTradeVolume_,
            oracleTimeout_,
            targetName_,
            delayUntilDefault_
        )
    {
        require(defaultThreshold_ > 0, "defaultThreshold zero");
        defaultThreshold = defaultThreshold_;
    }

    function priceNotInBounds(uint192 price, uint192 peg, uint192 delta) internal pure returns (bool) {
        return price < peg - delta || price > peg + delta;
    }

    function poolIsAwayFromOptimalPoint() internal pure returns (bool) {
        return true;
    }

    /// Refresh exchange rates and update default status.
    function refresh() external virtual override {
        if (alreadyDefaulted()) return;

        IUniswapV2Pair pair = IUniswapV2Pair(address(erc20));
        pair.sync();

        CollateralStatus oldStatus = status();

        try chainlinkFeed.price_(oracleTimeout) returns (uint192 price0) {
            try chainlinkFeedSecondAsset.price_(oracleTimeout) returns (uint192 price1) {
                uint192 peg = (pricePerTarget() * targetPerRef()) / FIX_ONE;
                uint192 delta = (peg * defaultThreshold) / FIX_ONE;
                if (
                    priceNotInBounds(price0, peg, delta) ||
                    priceNotInBounds(price1, peg, delta) ||
                    poolIsAwayFromOptimalPoint()
                ) {
                    markStatus(CollateralStatus.IFFY);
                } else {
                    markStatus(CollateralStatus.SOUND);
                }
            } catch (bytes memory errData) {
                if (errData.length == 0) revert();
                markStatus(CollateralStatus.IFFY);
            }
        } catch (bytes memory errData) {
            if (errData.length == 0) revert();
            markStatus(CollateralStatus.IFFY);
        }

        CollateralStatus newStatus = status();
        if (oldStatus != newStatus) {
            emit DefaultStatusChanged(oldStatus, newStatus);
        }
    }
    
}
