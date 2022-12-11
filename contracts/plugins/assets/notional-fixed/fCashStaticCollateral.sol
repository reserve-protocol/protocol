// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/plugins/assets/notional-fixed/fCashFiatPeggedCollateral.sol";
import "contracts/plugins/assets/notional-fixed/IReservefCashWrapper.sol";
import "contracts/libraries/Fixed.sol";

/**
 * @title fCashStaticCollateral
 * @notice Collateral plugin for fCash lending positions where lent underlying is Fiat pegged
 * Expected: {tok} != {ref}, {ref} == {target}, {target} != {UoA}
 */
contract fCashStaticCollateral is fCashFiatPeggedCollateral {

    /// @param _fallbackPrice {UoA} Price to be returned in worst case
    /// @param _targetPerRefFeed Feed units: {target/ref}
    /// @param _erc20Collateral Asset that the plugin manages
    /// @param _maxTradeVolume {UoA} The max trade volume, in UoA
    /// @param _oracleTimeout {s} The number of seconds until a oracle value becomes invalid
    /// @param _allowedDropBasisPoints {bps} Max drop allowed on refPerTok before defaulting
    /// @param _targetName Name of category
    /// @param _delayUntilDefault {s} The number of seconds deviation must occur before default
    /// @param _defaultThreshold {%} A value like 0.05 that represents a deviation tolerance
    constructor(
        uint192 _fallbackPrice,
        AggregatorV3Interface _targetPerRefFeed,
        IERC20Metadata _erc20Collateral,
        uint192 _maxTradeVolume,
        uint48 _oracleTimeout,
        uint16 _allowedDropBasisPoints,
        bytes32 _targetName,
        uint256 _delayUntilDefault,
        uint192 _defaultThreshold
    )
    fCashFiatPeggedCollateral(
        _fallbackPrice,
        _targetPerRefFeed,
        _erc20Collateral,
        _maxTradeVolume,
        _oracleTimeout,
        _allowedDropBasisPoints,
        _targetName,
        _delayUntilDefault,
        _defaultThreshold
    )
    {}

    function checkReferencePeg() internal override {}
}
