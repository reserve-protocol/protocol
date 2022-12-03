// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/plugins/assets/AbstractCollateral.sol";
import "contracts/libraries/Fixed.sol";
import "../OracleLib.sol";
import "./IWstETH.sol";

/**
 * @title WstETHCollateral
 * @notice Collateral plugin for wstETH (Wrapped liquid staked Ether)
 * Expected: {tok} = wstETH, {ref} = {target} = ETH, {UoA} = USD
 */
contract WstETHCollateral is Collateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    uint192 public immutable defaultThreshold; // {%} e.g. 0.1

    uint192 public prevReferencePrice; // previous rate, {collateral/reference}

    AggregatorV3Interface public immutable uoaPerRefFeed;
    AggregatorV3Interface public immutable uoaPerStETHFeed;

    /// @param fallbackPrice_ Fallbackprice {UoA/tok}
    /// @param uoaPerRefFeed_ Feed units: {UoA/ref}
    /// @param uoaPerStETHFeed_ Feed units: {UoA/stETH}
    /// @param maxTradeVolume_ {UoA} The max trade volume, in UoA
    /// @param oracleTimeout_ {s} The number of seconds until a oracle value becomes invalid
    /// @param defaultThreshold_ {%} A value like 0.1 that represents a deviation tolerance
    /// @param delayUntilDefault_ {s} The number of seconds deviation must occur before default
    constructor(
        uint192 fallbackPrice_,
        AggregatorV3Interface uoaPerRefFeed_,
        AggregatorV3Interface uoaPerStETHFeed_,
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        uint48 oracleTimeout_,
        bytes32 targetName_,
        uint192 defaultThreshold_,
        uint256 delayUntilDefault_
    )
        Collateral(
            fallbackPrice_,
            uoaPerRefFeed_,
            erc20_,
            maxTradeVolume_,
            oracleTimeout_,
            targetName_,
            delayUntilDefault_
        )
    {
        require(defaultThreshold_ > 0, "defaultThreshold zero");

        defaultThreshold = defaultThreshold_;
        uoaPerRefFeed = uoaPerRefFeed_;
        uoaPerStETHFeed = uoaPerStETHFeed_;
        prevReferencePrice = refPerTok();
    }

    /// Refresh exchange rates and update default status.
    /// @custom:interaction RCEI
    function refresh() external virtual override {
        // == Refresh ==
        if (alreadyDefaulted()) return;
        CollateralStatus oldStatus = status();

        // Check for hard default
        uint192 referencePrice = refPerTok();
        // uint192(<) is equivalent to Fix.lt
        if (referencePrice < prevReferencePrice) {
            markStatus(CollateralStatus.DISABLED);
        } else {
            try this.strictPrice() returns (uint192 tokPrice) {
                try this.pricePerRef() returns (uint192 uoaPerRefPrice) {
                    // D18{ref/tok}
                    uint192 ratio = tokPrice.mul(FIX_SCALE).div(uoaPerRefPrice);

                    // D18{ref/tok} = D18{ref/tok} * D18{1} / D18
                    uint192 delta = (referencePrice * defaultThreshold) / FIX_ONE; // D18{ref/tok}

                    // If the price is below the default-threshold price, default eventually
                    // uint192(+/-) is the same as Fix.plus/minus
                    if (ratio < referencePrice - delta || ratio > referencePrice + delta)
                        markStatus(CollateralStatus.IFFY);
                    else markStatus(CollateralStatus.SOUND);
                } catch (bytes memory errData) {
                    // see: docs/solidity-style.md#Catching-Empty-Data
                    if (errData.length == 0) revert(); // solhint-disable-line reason-string
                    markStatus(CollateralStatus.IFFY);
                }
            } catch (bytes memory errData) {
                // see: docs/solidity-style.md#Catching-Empty-Data
                if (errData.length == 0) revert(); // solhint-disable-line reason-string
                markStatus(CollateralStatus.IFFY);
            }
        }
        prevReferencePrice = referencePrice;

        CollateralStatus newStatus = status();
        if (oldStatus != newStatus) {
            emit CollateralStatusChanged(oldStatus, newStatus);
        }
        // No interactions beyond the initial refresher
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    /// Exchange rate is increasing over time becuase of the staking rewards + block fees
    /// Only decrasing aspect of {tok} is staking penalty
    /// {ref/tok} = {stETH/wstETH} * {ETH/stETH}
    /// Since {ETH/stETH} is 1 in ideal conditions:
    /// {ref/tok} = {stETH/wstETH} * 1 = {stETH/wstETH}
    function refPerTok() public view override returns (uint192) {
        return _safeWrap(IWstETH(address(erc20)).stEthPerToken());
    }

    /// @return {UoA/target} The price of a target unit in UoA
    /// Using uoaPerRefFeed because {ref} = {target}
    function pricePerTarget() public view override returns (uint192) {
        return uoaPerRefFeed.price(oracleTimeout);
    }

    /// @return {UoA/ref} The price of a reference unit in UoA
    function pricePerRef() public view returns (uint192) {
        return uoaPerRefFeed.price(oracleTimeout);
    }

    /// Can return 0, can revert
    /// @return {UoA/tok} The current price()
    /// Since {USD/wstETH} chainlink feed does not exist, we use this calculation:
    /// {UoA/tok} = {stETH/wstETH} * {USD/stETH}
    function strictPrice() public view override returns (uint192) {
        uint192 stEthPerWstEth = this.refPerTok();
        uint192 uoaPerStEth = uoaPerStETHFeed.price(oracleTimeout);
        return (stEthPerWstEth * uoaPerStEth) / FIX_ONE;
    }
}
