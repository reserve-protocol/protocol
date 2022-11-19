// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/plugins/assets/AbstractCollateral.sol";
import "contracts/plugins/assets/OracleLib.sol";
import "contracts/libraries/Fixed.sol";
import "./IFraxlendPair.sol";

/**
 * @title FTokenFiatCollateral 
 * @notice Collateral plugin for a fToken from Fraxlend of a fiat collateral that requires 
 * default checks (i.e USDC, DAI, and also EURT). 
 * Expected: {tok} != {ref}, {ref} should be pegged to {target}, {target} != {UoA}
 */

contract FTokenFiatCollateral is Collateral {
    using FixLib for uint192;
    using OracleLib for AggregatorV3Interface;

    AggregatorV3Interface public immutable uoaPerTargetFeed;

    uint192 public immutable defaultThreshold; // {%} e.g. 0.05

    uint192 public prevReferencePrice; // previous rate, {collateral/reference}

    int8 public immutable referenceERC20Decimals;

    /// @param uoaPerRefFeed_ {uoa/ref} only needed if, for example, the underlying
    /// is a non-USD stable coin like EURt, in which case this would be the chainlink 
    /// feed for EURt/USD 
    /// @param uoaPerTargetFeed_ {UoA/target}
    /// @param maxTradeVolume_ {UoA} The max trade volume, in UoA
    /// @param oracleTimeout_ {s} The number of seconds until a oracle value becomes invalid
    /// @param defaultThreshold_ {%} A value like 0.05 that represents a deviation tolerance
    /// @param delayUntilDefault_ {s} The number of seconds deviation must occur before default
 
    constructor(
        uint192 fallbackPrice_,
        AggregatorV3Interface uoaPerRefFeed_,
        AggregatorV3Interface uoaPerTargetFeed_,
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        uint48 oracleTimeout_,
        bytes32 targetName_,
        uint192 defaultThreshold_,
        uint256 delayUntilDefault_,
        int8 referenceERC20Decimals_
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
        require(referenceERC20Decimals_ > 0, "referenceERC20Decimals missing");
        require(address(uoaPerTargetFeed_) != address(0), "uoaPerTargetFeed missing");
        defaultThreshold = defaultThreshold_;
        referenceERC20Decimals = referenceERC20Decimals_;
        prevReferencePrice = refPerTok();

        uoaPerTargetFeed = uoaPerTargetFeed_;
    }

    /// @return {UoA/tok} Our best guess at the market price of 1 whole token in UoA
    function strictPrice() public view virtual override returns (uint192) {
        // {UoA/tok} = {UoA/target} * {target/ref} * {ref/tok}
        return
            uoaPerTargetFeed
                .price(oracleTimeout)
                .mul(targetPerRef())
                .mul(refPerTok());
    }

    /// Refresh exchange rates and update default status.
    /// @custom:interaction RCEI
    function refresh() external virtual override {
        if (alreadyDefaulted()) return;
        CollateralStatus oldStatus = status();

        // Check for hard default
        uint192 referencePrice = refPerTok();
        // uint192(<) is equivalent to Fix.lt
        if (referencePrice < prevReferencePrice) {
            markStatus(CollateralStatus.DISABLED);
        } else {
            if (IFraxlendPair(address(erc20)).paused()) markStatus(CollateralStatus.IFFY);

            // {uoa/target}
            try uoaPerTargetFeed.price_(oracleTimeout) returns (uint192 uoaPerTarget) {
                // {uoa/ref}
                try chainlinkFeed.price_(oracleTimeout) returns (uint192 uoaPerRef) {
                    // if there is a target/ref price feed
                    // {target/ref} = {u}{uoa/target}
                    uint192 p = uoaPerRef.div(uoaPerTarget);
                    uint192 peg = 1 ether;

                    // D18{target/ref}= D18{target/ref} * D18{1} / D18
                    uint192 delta = (peg * defaultThreshold) / peg;
                    // defaults if exchange rate between ref and target is not close to 1:1
                    if (p < peg - delta || p > peg + delta) markStatus(CollateralStatus.IFFY);

                    // defaults if the Fraxlend pair contract is paused
                    else markStatus(CollateralStatus.SOUND);

                } catch (bytes memory errData) {
                    if (errData.length == 0) revert(); // solhint-disable-line reason-string
                    markStatus(CollateralStatus.IFFY);
                }

            } catch (bytes memory errData) {
                if (errData.length == 0) revert(); // solhint-disable-line reason-string
                markStatus(CollateralStatus.IFFY);
            }
        }
        prevReferencePrice = referencePrice;

        CollateralStatus newStatus = status();
        if (oldStatus != newStatus) {
            emit DefaultStatusChanged(oldStatus, newStatus);
        }
    }

    function targetPerRef() public view override returns (uint192) {
        return address(chainlinkFeed) != address(0) ? 
            // {target/ref} = {uoa/ref} / {uoa/target}
            chainlinkFeed.price(oracleTimeout).div(uoaPerTargetFeed.price(oracleTimeout)) : 1 ether;
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function refPerTok() public view override returns (uint192) {
      return uint192(IFraxlendPair(address(erc20)).toAssetAmount(1 ether, false));
    }

    /// @return {UoA/target} The price of a target unit in UoA
    function pricePerTarget() public view override returns (uint192) {
        return uoaPerTargetFeed.price(oracleTimeout);
    }
}