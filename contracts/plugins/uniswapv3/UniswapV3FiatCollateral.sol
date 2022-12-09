// SPDX-License-Identifier: agpl-3.0
pragma solidity ^0.8.9;

import "./IUniswapV3Wrapper.sol";
import "./UniswapV3Collateral.sol";

contract UniswapV3FiatCollateral is UniswapV3Collateral {
    using OracleLib for AggregatorV3Interface;

    uint192 public immutable defaultThreshold;

    constructor(
        uint192 fallbackPrice_,
        AggregatorV3Interface chainlinkFeed_,
        AggregatorV3Interface chainlinkFeedSecondAsset_,
        IUniswapV3Wrapper uniswapV3Wrapper_,
        uint192 maxTradeVolume_,
        uint48 oracleTimeout_,
        bytes32 targetName_,
        uint192 defaultThreshold_,
        uint256 delayUntilDefault_
    )
        UniswapV3Collateral(
            fallbackPrice_,
            chainlinkFeed_,
            chainlinkFeedSecondAsset_,
            uniswapV3Wrapper_,
            maxTradeVolume_,
            oracleTimeout_,
            targetName_,
            delayUntilDefault_
        )
    {
        require(defaultThreshold_ > 0, "defaultThreshold zero");
        defaultThreshold = defaultThreshold_;
    }

    /*
This would be sensible for many UNI v2 pools, but someone holding value in a two-sided USD-fiatcoin pool probably intends to represent a USD position with those holdings, and so it'd be better for the Collateral plugin to have a target of USD. This is coherent so long as the Collateral plugin is setup to default under any of the following conditions:

- According to a trusted oracle, USDC is far from \$1 for some time
- According a trusted oracle, USDT is far from \$1 for some time
- The UNI v2 pool is far from the 1:1 point for some time

And even then, it would be somewhat dangerous for an RToken designer to use this LP token as a _backup_ Collateral position -- because whenever the pool's proportion is away from 1:1 at all, it'll take more than \$1 of collateral to buy an LP position that can reliably convert to \$1 later.
*/

    function priceNotInBounds(uint192 price, uint192 peg, uint192 delta) internal pure returns (bool) {
        return price < peg - delta || price > peg + delta;
    }

    function poolIsAwayFromOptimalPoint() internal pure returns (bool) {
        return true;
    }

    /// Refresh exchange rates and update default status.
    function refresh() external virtual override {
        if (alreadyDefaulted()) return;
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
            //TODO need we emit it? correct in other collateral?
            emit DefaultStatusChanged(oldStatus, newStatus);
        }
    }

    /// @return {UoA/target} The price of a target unit in UoA
    function pricePerTarget() public view override returns (uint192) {
        return FIX_ONE;
    }
}
