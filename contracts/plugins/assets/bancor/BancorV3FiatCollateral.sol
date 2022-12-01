// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/plugins/assets/AbstractCollateral.sol";
import "contracts/plugins/assets/ICToken.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/plugins/assets/bancor/IBancorV3FiatCollateral.sol";

/**
 * @title CTokenFiatCollateral
 * @notice Collateral plugin for a cToken of fiat collateral, like cUSDC or cUSDP
 * Expected: {tok} != {ref}, {ref} is pegged to {target} unless defaulting, {target} == {UoA}
 */
contract BancorV3FiatCollateral is Collateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    IBnTokenERC20 public immutable bnToken;

    /// @param chainlinkFeed_ Feed units: {UoA/ref}
    /// @param maxTradeVolume_ {UoA} The max trade volume, in UoA
    /// @param oracleTimeout_ {s} The number of seconds until a oracle value becomes invalid
    /// @param defaultThreshold_ {%} A value like 0.05 that represents a deviation tolerance
    /// @param delayUntilDefault_ {s} The number of seconds deviation must occur before default
    constructor(
        uint192 fallbackPrice_,
        AggregatorV3Interface chainlinkFeed_,
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        uint48 oracleTimeout_,
        bytes32 targetName_,
        uint256 delayUntilDefault_,
        address bancorERC20_
    )
        Collateral(
            fallbackPrice_,
            chainlinkFeed_,
            erc20_,
            maxTradeVolume_,
            oracleTimeout_,
            targetName_,
            delayUntilDefault_,
            bancorERC20_
        )
    {  
        require(bancorERC20_ != address(0), "Bancor address missing");

        bnToken = IBnTokenERC20(address(bancorERC20_));

    }

    /// @return {UoA/tok} Our best guess at the market price of 1 whole token in UoA
    function strictPrice() public view virtual override returns (uint192) {
        // {UoA/tok} = {UoA/ref} * {ref/tok}

    }

    /// Refresh exchange rates and update default status.
    /// @custom:interaction RCEI
    function refresh() external virtual override {

    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function refPerTok() public view override returns (uint192) {
        return bnToken.poolTokenToUnderlying(address(0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48),1e6);
    }

    /// Claim rewards earned by holding a balance of the ERC20 token
    /// @dev delegatecall
    function claimRewards() external virtual override {

    }
}
