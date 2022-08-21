// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "contracts/libraries/Fixed.sol";

error StalePrice();
error PriceOutsideRange();

/// Used by asset plugins to price their collateral
library OracleLib {
    /// @dev Use for on-the-fly calculations that should revert
    /// @param timeout The number of seconds after which oracle values should be considered stale
    /// @return {UoA/tok}
    function price(AggregatorV3Interface chainlinkFeed, uint48 timeout)
        internal
        view
        returns (uint192)
    {
        (uint80 roundId, int256 p, , uint256 updateTime, uint80 answeredInRound) = chainlinkFeed
            .latestRoundData();

        if (updateTime == 0 || answeredInRound < roundId) {
            revert StalePrice();
        }
        // Downcast is safe: uint256(-) reverts on underflow; block.timestamp assumed < 2^48
        uint48 secondsSince = uint48(block.timestamp - updateTime);
        if (secondsSince > timeout) revert StalePrice();

        // {UoA/tok}
        uint192 scaledPrice = shiftl_toFix(uint256(p), -int8(chainlinkFeed.decimals()));

        if (scaledPrice == 0) revert PriceOutsideRange();
        return scaledPrice;
    }

    /// @dev Use when a try-catch is necessary
    /// @param timeout The number of seconds after which oracle values should be considered stale
    /// @return {UoA/tok}
    function price_(AggregatorV3Interface chainlinkFeed, uint48 timeout)
        external
        view
        returns (uint192)
    {
        return price(chainlinkFeed, timeout);
    }
}
