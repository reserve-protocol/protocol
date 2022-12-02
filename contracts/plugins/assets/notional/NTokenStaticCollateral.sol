// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "contracts/plugins/assets/notional/AbstractNTokenCollateral.sol";
import "contracts/libraries/Fixed.sol";

/**
 * @title NTokenStaticCollateral
 * @notice Collateral plugin for a NToken of static collateral (native)
 * Expected: {tok} != {ref}, {ref} == {target}, {target} != {UoA}
 */
contract NTokenStaticCollateral is NTokenCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    /// @param _fallbackPrice {UoA} Price to be returned in worst case
    /// @param _uoaPerRefFeed Feed units: {uoa/ref}
    /// @param _erc20Collateral Asset that the plugin manages
    /// @param _maxTradeVolume {UoA} The max trade volume, in UoA
    /// @param _oracleTimeout {s} The number of seconds until a oracle value becomes invalid
    /// @param _allowedDropBasisPoints {bps} Max drop allowed on refPerTok before defaulting
    /// @param _targetName Name of category
    /// @param _delayUntilDefault {s} The number of seconds deviation must occur before default
    /// @param _notionalProxy Address of the NotionalProxy to communicate to the protocol
    /// @param _defaultThreshold {%} A value like 0.05 that represents a deviation tolerance
    constructor(
        uint192 _fallbackPrice,
        AggregatorV3Interface _uoaPerRefFeed,
        IERC20Metadata _erc20Collateral,
        uint192 _maxTradeVolume,
        uint48 _oracleTimeout,
        uint16 _allowedDropBasisPoints,
        bytes32 _targetName,
        uint256 _delayUntilDefault,
        address _notionalProxy,
        uint192 _defaultThreshold
    )
    NTokenCollateral(
        _fallbackPrice,
        _uoaPerRefFeed,
        _erc20Collateral,
        _maxTradeVolume,
        _oracleTimeout,
        _allowedDropBasisPoints,
        _targetName,
        _delayUntilDefault,
        _notionalProxy,
        _defaultThreshold
    )
    {}

    function checkReferencePeg() internal override {
        // pass
    }
}
