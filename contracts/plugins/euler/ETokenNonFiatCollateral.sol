// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "../assets/AbstractCollateral.sol";
import "./IEToken.sol";
import "../../libraries/Fixed.sol";

/**
 * @title ETokenNonFiatCollateral
 * @notice Collateral plugin for a eToken of nonfiat collateral that requires default checks,
 * like eWBTC. Expected: {tok} != {ref}, {ref} == {target}, {target} != {UoA}
 */
contract ETokenNonFiatCollateral is Collateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    AggregatorV3Interface public immutable targetUnitChainlinkFeed; // {UoA/target}

    // address of underlying reference token - i.e USDC uses 6 decimals
    int8 public immutable referenceERC20Decimals;

    uint192 public immutable defaultThreshold; // {%} e.g. 0.05

    uint192 public prevReferencePrice; // previous rate, {collateral/reference}

    /// @param refUnitChainlinkFeed_ Feed units: {target/ref}
    /// @param targetUnitUSDChainlinkFeed_ Feed units: {UoA/target}
    /// @param erc20_ address of eToken proxy contract 
    /// @param maxTradeVolume_ {UoA} The max trade volume, in UoA
    /// @param oracleTimeout_ {s} The number of seconds until a oracle value becomes invalid
    /// @param defaultThreshold_ {%} A value like 0.05 that represents a deviation tolerance
    /// @param delayUntilDefault_ {s} The number of seconds deviation must occur before default
    constructor(
        uint192 fallbackPrice_, 
        AggregatorV3Interface refUnitChainlinkFeed_,
        AggregatorV3Interface targetUnitUSDChainlinkFeed_,
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
            refUnitChainlinkFeed_,
            erc20_,
            maxTradeVolume_,
            oracleTimeout_,
            targetName_,
            delayUntilDefault_
        )
    {
        require(defaultThreshold_ > 0, "defaultThreshold zero");
        require(
            address(targetUnitUSDChainlinkFeed_) != address(0),
            "missing target unit chainlink feed"
        );
        require(referenceERC20Decimals_ > 0, "referenceERC20Decimals missing");
        defaultThreshold = defaultThreshold_;
        targetUnitChainlinkFeed = targetUnitUSDChainlinkFeed_;
        referenceERC20Decimals = referenceERC20Decimals_;

        prevReferencePrice = refPerTok();
    }

    /// @return {UoA/tok} Our best guess at the market price of 1 whole token in UoA
    function strictPrice() public view virtual override returns (uint192) {
        // {UoA/tok} = {target/ref} * {ref/tok} * {UoA/target}
        return chainlinkFeed.price(oracleTimeout)
                            .mul(refPerTok())
                            .mul(targetUnitChainlinkFeed.price(oracleTimeout));
    }

    /// Refresh exchange rates and update default status.
    /// @custom:interaction RCEI
    function refresh() external virtual override {
        // == Refresh ==
        // Update the token's accrued interest
        IEToken(address(erc20)).touch();

        if (alreadyDefaulted()) return;
        CollateralStatus oldStatus = status();

        // Check for hard default
        uint192 referencePrice = refPerTok();
        // uint192(<) is equivalent to Fix.lt
        if (referencePrice < prevReferencePrice) {
            markStatus(CollateralStatus.DISABLED);
        } else {
            // p {target/ref}
            try chainlinkFeed.price_(oracleTimeout) returns (uint192 p) {
                // We don't need the return value from this next feed, but it should still function
                try targetUnitChainlinkFeed.price_(oracleTimeout) returns (uint192) {
                    // {target/ref}
                    uint192 peg = 1 ether;

                    // D18{target/ref}= D18{target/ref} * D18{1} / D18
                    uint192 delta = (peg * defaultThreshold) / 1 ether;

                    // If the price is below the default-threshold price, default eventually
                    // uint192(+/-) is the same as Fix.plus/minus
                    if (p < peg - delta || p > peg + delta) markStatus(CollateralStatus.IFFY);
                    else markStatus(CollateralStatus.SOUND);
                } catch (bytes memory errData) {
                    // see: docs/solidity-style.md#Catching-Empty-Data
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
            emit CollateralStatusChanged(oldStatus, newStatus);
        }

        // No interactions beyond the initial refresher
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function refPerTok() public view override returns (uint192) {
        uint256 rate = IEToken(address(erc20)).convertBalanceToUnderlying(1 ether);
        int8 shiftLeft = -referenceERC20Decimals;
        return shiftl_toFix(rate, shiftLeft);
    }

    /// @return {UoA/target} The price of a target unit in UoA
    function pricePerTarget() public view override returns (uint192) {
        return targetUnitChainlinkFeed.price(oracleTimeout);
    }
}
