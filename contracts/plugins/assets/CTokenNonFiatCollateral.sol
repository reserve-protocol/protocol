// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/plugins/assets/CTokenFiatCollateral.sol";
import "contracts/plugins/assets/OracleLib.sol";
import "contracts/libraries/Fixed.sol";

/**
 * @title CTokenNonFiatCollateral
 * @notice Collateral plugin for a cToken of a nonfiat collateral that requires default checks
 * For example:
 *   - cWBTC
 */
contract CTokenNonFiatCollateral is CTokenFiatCollateral {
    using FixLib for uint192;
    using OracleLib for AggregatorV3Interface;

    AggregatorV3Interface public targetUnitChainlinkFeed;

    /// @param maxTradeVolume_ {UoA} The max amount of value to trade in an indivudual trade
    /// @param oracleTimeout_ {s} The number of seconds until a oracle value becomes invalid
    /// @param defaultThreshold_ {%} A value like 0.05 that represents a deviation tolerance
    /// @param delayUntilDefault_ {s} The number of seconds deviation must occur before default
    constructor(
        AggregatorV3Interface referenceUnitChainlinkFeed_,
        AggregatorV3Interface targetUnitChainlinkFeed_,
        IERC20Metadata erc20_,
        IERC20Metadata rewardERC20_,
        uint192 maxTradeVolume_,
        uint32 oracleTimeout_,
        bytes32 targetName_,
        uint192 defaultThreshold_,
        uint256 delayUntilDefault_,
        int8 referenceERC20Decimals_,
        address comptrollerAddr_
    )
        CTokenFiatCollateral(
            referenceUnitChainlinkFeed_,
            erc20_,
            rewardERC20_,
            maxTradeVolume_,
            oracleTimeout_,
            targetName_,
            defaultThreshold_,
            delayUntilDefault_,
            referenceERC20Decimals_,
            comptrollerAddr_
        )
    {
        targetUnitChainlinkFeed = targetUnitChainlinkFeed_;
    }

    /// @return {UoA/target} The price of a target unit in UoA
    function pricePerTarget() public view override returns (uint192) {
        return targetUnitChainlinkFeed.price(oracleTimeout);
    }
}
