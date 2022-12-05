// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/plugins/assets/AbstractCollateral.sol";
import "contracts/plugins/assets/ICToken.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/plugins/assets/bancor/IBnTokenERC20.sol";
import "hardhat/console.sol";

/**
 * @title CTokenFiatCollateral
 * @notice Collateral plugin for a cToken of fiat collateral, like cUSDC or cUSDP
 * Expected: {tok} != {ref}, {ref} is pegged to {target} unless defaulting, {target} == {UoA}
 */
contract BancorV3FiatCollateral is Collateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

     int8 public immutable ERC20Decimals;
    IBnTokenERC20 public immutable bnToken;

    /// @param chainlinkFeed_ Feed units: {UoA/ref}
    /// @param maxTradeVolume_ {UoA} The max trade volume, in UoA
    /// @param oracleTimeout_ {s} The number of seconds until a oracle value becomes invalid
    /// @param delayUntilDefault_ {s} The number of seconds deviation must occur before default
    constructor(
        uint192 fallbackPrice_,
        AggregatorV3Interface chainlinkFeed_,
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        uint48 oracleTimeout_,
        bytes32 targetName_,
        uint256 delayUntilDefault_,
        int8 ERC20Decimals_,
        address bnToken_
    )
        Collateral(
            fallbackPrice_,
            chainlinkFeed_,
            erc20_,
            maxTradeVolume_,
            oracleTimeout_,
            targetName_,
            delayUntilDefault_
        )
    {  
        require(address(bnToken_) != address(0), "missing erc20");
        bnToken = IBnTokenERC20(address(bnToken_));
        ERC20Decimals = ERC20Decimals_;
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
        uint192 rate = uint192(bnToken.poolTokenToUnderlying(address(0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48),1e6));
        return rate;
    }

    /// Claim rewards earned by holding a balance of the ERC20 token
    /// @dev delegatecall
    function claimRewards() external virtual override {

    }
}
