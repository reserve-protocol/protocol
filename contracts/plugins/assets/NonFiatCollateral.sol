// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/plugins/assets/FiatCollateral.sol";

/**
 * @title NonFiatCollateral
 * @notice Collateral plugin for a nonfiat collateral that requires default checks, such as WBTC
 */
contract NonFiatCollateral is FiatCollateral {
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
        uint256 delayUntilDefault_
    )
        FiatCollateral(
            referenceUnitChainlinkFeed_,
            erc20_,
            rewardERC20_,
            maxTradeVolume_,
            oracleTimeout_,
            targetName_,
            defaultThreshold_,
            delayUntilDefault_
        )
    {
        require(
            address(targetUnitChainlinkFeed_) != address(0),
            "missing target unit chainlink feed"
        );
        targetUnitChainlinkFeed = targetUnitChainlinkFeed_;
    }

    /// @return {UoA/target} The price of a target unit in UoA
    function pricePerTarget() public view override returns (uint192) {
        return targetUnitChainlinkFeed.price(oracleTimeout);
    }
}
