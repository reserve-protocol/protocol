// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/plugins/assets/AbstractCollateral.sol";
import "contracts/plugins/assets/ICToken.sol";
import "contracts/plugins/assets/OracleLib.sol";
import "contracts/libraries/Fixed.sol";
import "./IRETH.sol";

/**
 * @title RETHCollateral
 * @notice Collateral plugin for the reth token as collateral that requires default checks.
 * Expected: {tok} != {ref}, {ref} == {target}, {target} != {UoA}
 * tok = rETH, ref = ETH, target = ETH, UoA = USD/fiat
 */
contract RETHCollateral is Collateral {
    using FixLib for uint192;
    using OracleLib for AggregatorV3Interface;

    /// Should not use Collateral.chainlinkFeed, since naming is ambiguous

    uint192 public immutable marginRatio; // max drop allowed // D18
    uint192 public maxRefPerTok; // max rate previous seen, {ref/tok}

    /// @param refUnitUSDChainlinkFeed_ Feed units: {UoA/ref}
    /// @param maxTradeVolume_ {UoA} The max trade volume, in UoA
    /// @param oracleTimeout_ {s} The number of seconds until a oracle value becomes invalid
    /// @param _allowedDropBasisPoints {%} A value like 5 that represents
    /// the max drop in ref price before default out of 10000 basis points.
    /// @param delayUntilDefault_ {s} The number of seconds deviation must occur before default
    constructor(
        uint192 fallbackPrice_,
        AggregatorV3Interface refUnitUSDChainlinkFeed_,
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        uint48 oracleTimeout_,
        bytes32 targetName_,
        uint16 _allowedDropBasisPoints,
        uint256 delayUntilDefault_
    )
        Collateral(
            fallbackPrice_,
            refUnitUSDChainlinkFeed_,
            erc20_,
            maxTradeVolume_,
            oracleTimeout_,
            targetName_,
            delayUntilDefault_
        )
    {
        require(
            address(refUnitUSDChainlinkFeed_) != address(0),
            "missing target unit chainlink feed"
        );
        require(_allowedDropBasisPoints < 10000, "Allowed refPerTok drop out of range");

        maxRefPerTok = actualRefPerTok();
        marginRatio = 10000 - _allowedDropBasisPoints;
    }

    /// @return {UoA/tok} Our best guess at the market price of 1 whole token in UoA
    function strictPrice() public view virtual override returns (uint192) {
        // {UoA/tok} = {UoA/target} * {target/ref} * {ref/tok}
        return chainlinkFeed.price(oracleTimeout)
                .mul(actualRefPerTok());
    }

    /// Refresh exchange rates and update default status.
    /// @custom:interaction RCEI
    function refresh() external virtual override {
        if (alreadyDefaulted()) return;
        CollateralStatus oldStatus = status();

        uint192 _actualRefPerTok = actualRefPerTok();

        // check if refPerTok rate has decreased below the accepted threshold
        if (_actualRefPerTok < refPerTok()) {
            markStatus(CollateralStatus.DISABLED);
        } else {
            // p {target/ref}
            try this.strictPrice() returns (uint192) {
                markStatus(CollateralStatus.SOUND);
            } catch (bytes memory errData) {
                // see: docs/solidity-style.md#Catching-Empty-Data
                if (errData.length == 0) revert(); // solhint-disable-line reason-string
                markStatus(CollateralStatus.IFFY);
            }
        }

        // store actual refPerTok if it's the highest seen
        if (_actualRefPerTok > maxRefPerTok) {
            maxRefPerTok = _actualRefPerTok;
        }

        CollateralStatus newStatus = status();
        if (oldStatus != newStatus) {
            emit CollateralStatusChanged(oldStatus, newStatus);
        }
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function actualRefPerTok() public view returns (uint192) {
        return uint192(IRETH(address(erc20)).getExchangeRate());
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    /// @dev This amount has a {margin} space discounted to allow a certain drop on value
    function refPerTok() public view override returns (uint192) {
        return maxRefPerTok.mul(marginRatio).div(10000);
    }

    /// @return {UoA/target} The price of a target unit in UoA
    function pricePerTarget() public view override returns (uint192) {
        return chainlinkFeed.price(oracleTimeout);
    }
}
