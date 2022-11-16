// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/plugins/assets/AbstractCollateral.sol";
import "contracts/plugins/assets/OracleLib.sol";
import "contracts/libraries/Fixed.sol";
import "./IFraxlendPair.sol";

/**
 * @title FTokenNonFiatCollateral 
 * @notice Collateral plugin for a fToken from Fraxlend of nonfiat collateral that requires 
 * default checks. Expected: {tok} != {ref}, {ref} should be pegged to {target}, {target} != {UoA}
 */

contract FTokenNonFiatCollateral is Collateral {
    using FixLib for uint192;
    using OracleLib for AggregatorV3Interface;

    AggregatorV3Interface public immutable uoaPerTargetFeed;

    uint192 public immutable defaultThreshold; // {%} e.g. 0.05

    uint192 public prevReferencePrice; // previous rate, {collateral/reference}
    address public immutable comptrollerAddr;

    int8 public immutable referenceERC20Decimals;

    /// @param targetPerRefFeed_ {target/ref} only needed if, for example, the underlying token
    // is a wrapped token (i.e wBTC), in which case this would be the address for 
    // the chainlink wBTC/BTC feed
    /// @param uoaPerTargetFeed_ {UoA/target}
    /// @param maxTradeVolume_ {UoA} The max trade volume, in UoA
    /// @param oracleTimeout_ {s} The number of seconds until a oracle value becomes invalid
    /// @param defaultThreshold_ {%} A value like 0.05 that represents a deviation tolerance
    /// @param delayUntilDefault_ {s} The number of seconds deviation must occur before default
 
    constructor(
        uint192 fallbackPrice_,
        AggregatorV3Interface targetPerRefFeed_,
        AggregatorV3Interface uoaPerTargetFeed_,
        IERC20Metadata erc20_,
        IERC20Metadata rewardERC20_,
        uint192 maxTradeVolume_,
        uint48 oracleTimeout_,
        bytes32 targetName_,
        uint192 defaultThreshold_,
        uint256 delayUntilDefault_,
        int8 referenceERC20Decimals_,
        address comptrollerAddr_
    )
        Collateral(
            fallbackPrice_,
            targetPerRefFeed_,
            erc20_,
            rewardERC20_,
            maxTradeVolume_,
            oracleTimeout_,
            targetName_,
            delayUntilDefault_
        )
    {
        require(defaultThreshold_ > 0, "defaultThreshold zero");
        require(referenceERC20Decimals_ > 0, "referenceERC20Decimals missing");
        require(address(uoaPerTargetFeed_) != address(0), "uoaPerTargetFeed missing");
        require(address(comptrollerAddr_) != address(0), "comptrollerAddr missing");
        defaultThreshold = defaultThreshold_;
        referenceERC20Decimals = referenceERC20Decimals_;
        prevReferencePrice = refPerTok();
        comptrollerAddr = comptrollerAddr_;

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
            // p {target/ref}
            try uoaPerTargetFeed.price_(oracleTimeout) returns (uint192) {
                // if there is a target/ref price feed
                if (address(chainlinkFeed) != address(0)){
                    // {target/ref}
                    uint192 p = targetPerRef();
                    uint192 peg = FIX_ONE;

                    // D18{target/ref}= D18{target/ref} * D18{1} / D18
                    uint192 delta = (peg * defaultThreshold) / FIX_ONE;
                    // defaults if exchange rate between target and ref is not close to 1:1
                    if (p < peg - delta || p > peg + delta) markStatus(CollateralStatus.IFFY);
                }

                // defaults if the Fraxlend pair contract is paused
                if (IFraxlendPair(address(erc20)).paused()) markStatus(CollateralStatus.IFFY);
                else markStatus(CollateralStatus.SOUND);
     
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

    /// @return {target/ref} Quantity of whole target units per whole reference units 
    function targetPerRef() public view override returns (uint192){
        return address(chainlinkFeed) != address(0) ? chainlinkFeed.price(oracleTimeout) : FIX_ONE;
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function refPerTok() public view override returns (uint192) {
      return uint192(IFraxlendPair(address(erc20)).toAssetAmount(FIX_ONE, false));
    }

    /// @return {UoA/target} The price of a target unit in UoA
    function pricePerTarget() public view override returns (uint192) {
        return uoaPerTargetFeed.price(oracleTimeout);
    }
}