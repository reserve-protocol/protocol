// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "../../libraries/Fixed.sol";
import "./OracleErrors.sol";

interface EACAggregatorProxy {
    function aggregator() external view returns (address);
}

/// Used by asset plugins to price their collateral
library OracleLib {
    uint48 internal constant ORACLE_TIMEOUT_BUFFER = 300; // {s} 5 minutes

    /// @dev Use for nested calls that should revert when there is a problem
    /// @param timeout The number of seconds after which oracle values should be considered stale
    /// @return {UoA/tok}
    function price(AggregatorV3Interface chainlinkFeed, uint48 timeout)
        internal
        view
        returns (uint192)
    {
        try chainlinkFeed.latestRoundData() returns (
            uint80 roundId,
            int256 p,
            uint256,
            uint256 updateTime,
            uint80 answeredInRound
        ) {
            if (updateTime == 0 || answeredInRound < roundId) {
                revert StalePrice();
            }

            // Downcast is safe: uint256(-) reverts on underflow; block.timestamp assumed < 2^48
            uint48 secondsSince = uint48(block.timestamp - updateTime);
            if (secondsSince > timeout + ORACLE_TIMEOUT_BUFFER) revert StalePrice();

            if (p <= 0) revert InvalidPrice();

            // {UoA/tok}
            return shiftl_toFix(uint256(p), -int8(chainlinkFeed.decimals()), FLOOR);
        } catch (bytes memory errData) {
            // Check if the aggregator was not set: if so, the chainlink feed has been deprecated
            // and a _specific_ error needs to be raised in order to avoid looking like OOG
            if (errData.length == 0) {
                if (EACAggregatorProxy(address(chainlinkFeed)).aggregator() == address(0)) {
                    revert StalePrice();
                }
                // solhint-disable-next-line reason-string
                revert();
            }

            // Otherwise, preserve the error bytes
            // solhint-disable-next-line no-inline-assembly
            assembly {
                revert(add(32, errData), mload(errData))
            }
        }
    }
}
