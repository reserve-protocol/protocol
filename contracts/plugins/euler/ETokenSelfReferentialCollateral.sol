// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "../assets/AbstractCollateral.sol";
import "./IEToken.sol";
import "../../libraries/Fixed.sol";

/**
 * @title ETokenSelfReferentialCollateral
 * @notice Collateral plugin for collateral that is its own target and reference unit,
 * like eWETH, eLINK, etc.
 * Expected: {tok} == {ref} == {target}, and {target} is probably not {UoA}
 * Self-referential collateral can default if the oracle becomes stale for long enough.
 */
contract ETokenSelfReferentialCollateral is Collateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    // address of underlying reference token - i.e USDC uses 6 decimals
    int8 public immutable referenceERC20Decimals;
    uint192 public prevReferencePrice; // previous rate, {collateral/reference}

    /// @param chainlinkFeed_ Feed units: {UoA/ref}
    /// @param erc20_ address of eToken proxy contract (can be retrieved from Markets.sol:underlyingToEToken())
    /// i.e. the proxy for eUSDC is at: 0xEb91861f8A4e1C12333F42DCE8fB0Ecdc28dA716
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
        int8 referenceERC20Decimals_
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
        require(referenceERC20Decimals_ > 0, "referenceERC20Decimals missing");
        referenceERC20Decimals = referenceERC20Decimals_;

        prevReferencePrice = refPerTok();
    }

    /// @return {UoA/tok} Our best guess at the market price of 1 whole token in UoA
    function strictPrice() public view virtual override returns (uint192) {
        // {UoA/tok} = {UoA/ref} * {ref/tok}
        return chainlinkFeed.price(oracleTimeout).mul(refPerTok());
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
            try chainlinkFeed.price_(oracleTimeout) returns (uint192) {
                markStatus(CollateralStatus.SOUND);
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
    function refPerTok() public view override returns (uint192) {
        uint256 rate = IEToken(address(erc20)).convertBalanceToUnderlying(1 ether);
        int8 shiftLeft = -referenceERC20Decimals;
        return shiftl_toFix(rate, shiftLeft);
    }

    /// @return {UoA/target} The price of a target unit in UoA
    function pricePerTarget() public view override returns (uint192) {
        return chainlinkFeed.price(oracleTimeout);
    }
}
