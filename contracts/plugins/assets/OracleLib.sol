// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "contracts/libraries/Fixed.sol";

error StaleChainlinkPrice();
error PriceOutsideRange();

/// Used by asset plugins to price their collateral
library OracleLib {
    /// Both internal and external versions of the price method are available for try catch

    /// @param timeout The number of seconds after which oracle values should be considered stale
    /// @return {UoA/tok}
    function price(AggregatorV3Interface chainlinkFeed, uint32 timeout)
        internal
        view
        returns (uint192)
    {
        return _price(chainlinkFeed, timeout);
    }

    /// @param timeout The number of seconds after which oracle values should be considered stale
    /// @return {UoA/tok}
    function price_(AggregatorV3Interface chainlinkFeed, uint32 timeout)
        external
        view
        returns (uint192)
    {
        return _price(chainlinkFeed, timeout);
    }

    /// @param timeout The number of seconds after which oracle values should be considered stale
    /// @return {UoA/tok}
    function _price(AggregatorV3Interface chainlinkFeed, uint32 timeout)
        private
        view
        returns (uint192)
    {
        (uint80 roundId, int256 p, , uint256 updateTime, uint80 answeredInRound) = chainlinkFeed
            .latestRoundData();

        if (updateTime == 0 || answeredInRound < roundId) {
            revert StaleChainlinkPrice();
        }

        uint32 secondsSince = uint32(block.timestamp - updateTime);
        if (secondsSince > timeout) revert StaleChainlinkPrice();

        // TODO other checks, maybe against Uni or Compound?

        // {UoA/tok}
        uint192 scaledPrice = shiftl_toFix(uint256(p), -int8(chainlinkFeed.decimals()));

        if (scaledPrice == 0) revert PriceOutsideRange();
        return scaledPrice;
    }
}
