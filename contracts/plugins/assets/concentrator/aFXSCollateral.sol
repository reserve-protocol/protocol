// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/plugins/assets/AbstractCollateral.sol";
import "contracts/libraries/Fixed.sol";
import "./IaFXS.sol";

/**
 * @title aFXSCollateral
 * @notice Collateral plugin for a aFXS collateral from Concentrator
 * Expected: {tok} != {ref}, {ref} == {target}, {target} != {UoA}
 */
contract aFXSCollateral is Collateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    uint192 private prevReferencePrice; // previous rate, {collateral/reference}

    /// @param _fallbackPrice {UoA} Price to be returned in worst case
    /// @param _uoaPerTargetFeed Feed units: {UoA/ref}
    /// @param _erc20Collateral Asset that the plugin manages
    /// @param _maxTradeVolume {UoA} The max trade volume, in UoA
    /// @param _oracleTimeout {s} The number of seconds until a oracle value becomes invalid
    /// @param _targetName Name of category
    /// @param _delayUntilDefault {s} The number of seconds deviation must occur before default
    constructor(
        uint192 _fallbackPrice,
        AggregatorV3Interface _uoaPerTargetFeed,
        IERC20Metadata _erc20Collateral,
        uint192 _maxTradeVolume,
        uint48 _oracleTimeout,
        bytes32 _targetName,
        uint256 _delayUntilDefault
    )
    Collateral(
        _fallbackPrice,
        _uoaPerTargetFeed,
        _erc20Collateral,
        _maxTradeVolume,
        _oracleTimeout,
        _targetName,
        _delayUntilDefault
    )
    {}

    /// @return {UoA/tok} Our best guess at the market price of 1 whole token in UoA
    function strictPrice() public view override returns (uint192) {
        // {UoA/tok} = {UoA/ref} * {ref/tok}
        return chainlinkFeed.price(oracleTimeout).mul(refPerTok());
    }

    /// Refresh exchange rates and update default status.
    /// @custom:interaction RCEI
    function refresh() external virtual override {
        if (alreadyDefaulted()) return;
        CollateralStatus oldStatus = status();

        uint192 referencePrice = refPerTok();
        // Check for hard default
        if (referencePrice < prevReferencePrice) {
            markStatus(CollateralStatus.DISABLED);
        }
        prevReferencePrice = referencePrice;

        CollateralStatus newStatus = status();
        if (oldStatus != newStatus) {
            emit CollateralStatusChanged(oldStatus, newStatus);
        }

        // No interactions beyond the initial refresher
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function refPerTok() public view override returns (uint192) {
        IaFXS aFXS = IaFXS(address(erc20));
        uint256 totalSupply = aFXS.totalSupply();
        uint256 underlyingValue = aFXS.totalAssets();
        return _safeWrap(underlyingValue * FIX_ONE / totalSupply);
    }

    /// Claim rewards earned by holding a balance of the ERC20 token
    /// @dev delegatecall
    function claimRewards() external virtual override {
        // calling this function is optional, but its offered
        // here because there is an incentive for users to harvest
        // rewards themselves, the claimer gets the harvest fee.
        // If users of RToken don't do it, someone will still do it,
        // and they will keep the fee
        IaFXS(address(erc20)).harvest(address(this), 0);
        // we are not emitting an event because no external rewards come from this
    }
}
