// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "contracts/libraries/Fixed.sol";

error StaleChainlinkPrice(AggregatorV3Interface);
error PriceOutsideRange(AggregatorV3Interface);

library OracleLib {
    /// @return {UoA/tok}
    function price(AggregatorV3Interface chainlinkFeed) internal view returns (uint192) {
        (uint80 roundId, int256 p, , uint256 updateTime, uint80 answeredInRound) = chainlinkFeed
            .latestRoundData();

        if (updateTime == 0 || answeredInRound < roundId) {
            revert StaleChainlinkPrice(chainlinkFeed);
        }

        // TODO other checks, maybe against Compound's sanitized values

        // {UoA/tok}
        uint192 scaledPrice = shiftl_toFix(uint256(p), 18 - int8(chainlinkFeed.decimals()));

        if (scaledPrice == 0) revert PriceOutsideRange(chainlinkFeed);
        return scaledPrice;
    }
}
