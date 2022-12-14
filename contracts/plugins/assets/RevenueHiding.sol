// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "contracts/plugins/assets/AbstractCollateral.sol";
import "contracts/libraries/Fixed.sol";

/**
 * @title Revenue Hiding
 * Abstract contract to contain general logic of a plugin using Revenue Hiding strategy
 * Expected: {tok} != {ref}, {ref} is pegged to {target} unless defaulting, {target} == {UoA}
 */
abstract contract RevenueHiding is Collateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    uint192 private immutable marginRatio; // max drop allowed
    uint192 private maxRefPerTok; // max rate previously seen {ref/tok} // D18

    constructor(
        uint192 _fallbackPrice,
        AggregatorV3Interface _chainlinkFeed,
        IERC20Metadata _erc20Collateral,
        uint192 _maxTradeVolume,
        uint48 _oracleTimeout,
        bytes32 _targetName,
        uint256 _delayUntilDefault,
        uint192 _allowedDropBasisPoints
    )
        Collateral(
            _fallbackPrice,
            _chainlinkFeed,
            _erc20Collateral,
            _maxTradeVolume,
            _oracleTimeout,
            _targetName,
            _delayUntilDefault
        )
    {
        require(_allowedDropBasisPoints < 10000, "Allowed refPerTok drop out of range");

        marginRatio = 10000 - _allowedDropBasisPoints;
    }

    /// Can return 0, can revert
    /// Shortcut for price(false)
    /// @return {UoA/tok} The current price(), without considering fallback prices
    function strictPrice() external view virtual returns (uint192) {
        return chainlinkFeed.price(oracleTimeout).mul(actualRefPerTok());
    }

    /// Refresh exchange rates and update default status.
    /// The Reserve protocol calls this at least once per transaction, before relying on
    /// this collateral's prices or default status.
    function refresh() external override {
        if (alreadyDefaulted()) return;

        CollateralStatus oldStatus = status();

        uint192 _actualRefPerTok = actualRefPerTok();

        // check if refPerTok rate has decreased below the accepted threshold
        if (_actualRefPerTok < refPerTok()) {
            markStatus(CollateralStatus.DISABLED);
        } else {
            // if it didn't, check the peg of the reference
            checkReferencePeg();
        }

        // store actual refPerTok if it's the highest seen
        if (_actualRefPerTok > maxRefPerTok) {
            maxRefPerTok = _actualRefPerTok;
        }

        // check if updated status
        CollateralStatus newStatus = status();
        if (oldStatus != newStatus) {
            emit CollateralStatusChanged(oldStatus, newStatus);
        }
    }

    /// @dev Implement here the logic to check the peg status of the reference
    function checkReferencePeg() internal virtual;

    /// @return {ref/tok} Actual quantity of whole reference units per whole collateral tokens
    /// @dev This is the real refPerTok according to the markets
    function actualRefPerTok() public view virtual returns (uint192);

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    /// @dev This amount has a {margin} space discounted to allow a certain drop on value
    function refPerTok() public view override returns (uint192) {
        return maxRefPerTok.mul(marginRatio).div(10000);
    }
}
