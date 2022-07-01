// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/plugins/assets/CTokenFiatCollateral.sol";
import "contracts/plugins/assets/OracleLib.sol";

/**
 * @title CTokenBridgedCollateral
 * @notice Collateral plugin for a cToken of a bridged asset. For example:
 *   - cWBTC
 *   - ...
 */
contract CTokenBridgedCollateral is CTokenFiatCollateral {
    using OracleLib for AggregatorV3Interface;

    /// @param maxTradeVolume_ {UoA} The max amount of value to trade in an indivudual trade
    /// @param oracleTimeout_ {s} The number of seconds until a oracle value becomes invalid
    /// @param defaultThreshold_ {%} A value like 0.05 that represents a deviation tolerance
    /// @param delayUntilDefault_ {s} The number of seconds deviation must occur before default
    // solhint-disable no-empty-blocks
    constructor(
        AggregatorV3Interface chainlinkFeed_,
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        uint32 oracleTimeout_,
        bytes32 targetName_,
        uint192 defaultThreshold_,
        uint256 delayUntilDefault_,
        int8 referenceERC20Decimals_,
        IERC20 rewardERC20_,
        address comptrollerAddr_
    )
        CTokenFiatCollateral(
            chainlinkFeed_,
            erc20_,
            maxTradeVolume_,
            oracleTimeout_,
            targetName_,
            defaultThreshold_,
            delayUntilDefault_,
            referenceERC20Decimals_,
            rewardERC20_,
            comptrollerAddr_
        )
    {}

    // solhint-enable no-empty-blocks

    /// @return {UoA/target} The price of a target unit in UoA
    function pricePerTarget() public view override returns (uint192) {
        return chainlinkFeed.price(oracleTimeout);
    }
}
