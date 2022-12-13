// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "./AbstractCollateral.sol";
import "./ICToken.sol";
import "./IMCToken.sol";
import "../../libraries/Fixed.sol";

/**
 * @title MorphoFiatCollateral
 * @notice Collateral plugin for a mcToken of fiat collateral, like mcDAI, mcUSDC or mcUSDT
 * Expected: {tok} != {ref}, {ref} is pegged to {target} unless defaulting, {target} == {UoA}
 *
 * tok: mcTOK
 * ref: TOK
 * tar: TOK
 * uoa: USD
 */
contract MorphoFiatCollateral is Collateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    // All mcTokens have 18 decimals, but their underlying may have 18 or 6 or something else.

    int8 public immutable referenceERC20Decimals;

    uint192 public immutable defaultThreshold; // {%} e.g. 0.05

    uint192 public prevReferencePrice; // previous rate, {collateral/reference}

    IComptroller public immutable comptroller;

    /// @param chainlinkFeed_ Feed units: {UoA/ref}
    /// @param maxTradeVolume_ {UoA} The max trade volume, in UoA
    /// @param oracleTimeout_ {s} The number of seconds until a oracle value becomes invalid
    /// @param defaultThreshold_ {%} Minimum acceptable market price of ref in UoA
    /// @param delayUntilDefault_ {s} The number of seconds deviation must occur before default
    constructor(
        uint192 fallbackPrice_,
        AggregatorV3Interface chainlinkFeed_,
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        uint48 oracleTimeout_,
        bytes32 targetName_,
        uint192 defaultThreshold_,
        uint256 delayUntilDefault_,
        int8 referenceERC20Decimals_,
        IComptroller comptroller_
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
        require(defaultThreshold_ > 0, "defaultThreshold zero");
        require(referenceERC20Decimals_ > 0, "referenceERC20Decimals missing");
        require(address(comptroller_) != address(0), "comptroller missing");
        defaultThreshold = defaultThreshold_;
        referenceERC20Decimals = referenceERC20Decimals_;

        prevReferencePrice = refPerTok();
        comptroller = comptroller_;
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
        // Update the Compound Protocol
        address cTok = IMCToken(address(erc20)).poolToken();
        ICToken(cTok).exchangeRateCurrent();

        if (alreadyDefaulted()) return;
        CollateralStatus oldStatus = status();

        // Check for hard default
        uint192 referencePrice = refPerTok();
        // uint192(<) is equivalent to Fix.lt
        if (referencePrice < prevReferencePrice) {
            markStatus(CollateralStatus.DISABLED);
        } else {
            try chainlinkFeed.price_(oracleTimeout) returns (uint192 p) {
                // If the price is below the default-threshold price, default eventually
                if (p < defaultThreshold) markStatus(CollateralStatus.IFFY);
                else if (oldStatus != CollateralStatus.SOUND) markStatus(CollateralStatus.SOUND);
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
        // the more decimals in underlying the more negative shift left should be.
        uint256 rate = IMCToken(address(erc20)).convertToAssets(1 ether);
        return _safeWrap(rate);
    }

    /// Claim rewards earned by holding a balance of the ERC20 token
    /// @dev delegatecall
    function claimRewards() external virtual override {
        IERC20 comp = IERC20(comptroller.getCompAddress());
        uint256 oldBal = comp.balanceOf(address(this));
        IMCToken(address(erc20)).claimRewards(address(this));
        emit RewardsClaimed(comp, comp.balanceOf(address(this)) - oldBal);
    }
}
