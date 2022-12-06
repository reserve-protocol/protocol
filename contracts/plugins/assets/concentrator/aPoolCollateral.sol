// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/plugins/assets/AbstractCollateral.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/plugins/assets/concentrator/IaV1.sol";
import "contracts/plugins/assets/concentrator/IaV2.sol";
import "contracts/plugins/assets/concentrator/IaPool.sol";

/**
 * @title aPoolCollateral
 * @notice Collateral plugin for aPool assets from Concentrator. aCRV, aFXS
 * Expected: {tok} != {ref}, {ref} == {target}, {target} != {UoA}
 */
contract aPoolCollateral is Collateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    uint8 private immutable version; // version of the pool's interface
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
        uint256 _delayUntilDefault,
        uint8 _version
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
    {
        require(_version > 0 && _version <= 2, "invalid version number");

        version = _version;
    }

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
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function refPerTok() public view override returns (uint192) {
        return _safeWrap(getRate());
    }

    /// Computes the {ref/tok} depending on which version of the pool is being used
    function getRate() private view returns (uint256) {
        if (version == 1) {
            IaV1 pool = IaV1(address(erc20));
            return pool.totalUnderlying() * FIX_ONE / pool.totalSupply();
        }
        else {
            IaV2 pool = IaV2(address(erc20));
            return pool.totalAssets() * FIX_ONE / pool.totalSupply();
        }
    }

    /// Claim rewards earned by holding a balance of the ERC20 token
    /// @dev delegatecall
    function claimRewards() external virtual override {
        // calling this function is optional, but its offered
        // here because there is an incentive for users to harvest
        // rewards themselves, the claimer gets the harvest fee.
        // If users of RToken don't do it, someone will still do it,
        // and they will keep the fee
        uint256 previousBalance = erc20.balanceOf(address(this));
        IaPool(address(erc20)).harvest(address(this), 0);
        // since by harvesting ourselves we might be rewarded some more _aTokens_
        // we keep track of the potential increase on value and fire the event
        emit RewardsClaimed(address(erc20), erc20.balanceOf(address(this)) - previousBalance);
    }
}
