// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "../../libraries/Fixed.sol";
import "./AbstractCollateral.sol";
import "./IrEARN.sol";

/**
 * @title RibbonEarnStEthCollateral
 * @notice Collateral plugin for the Ribbon Earn stEth Vault
 * Expected: {tok} == rEARN-stEth, {ref} == stEth, {target} == ETH, 
 * {UoA} == USD, {ref} should stay above {target} or defaults
 */
contract RibbonEarnStEthCollateral is Collateral {
    using FixLib for uint192;
    using OracleLib for AggregatorV3Interface;

    uint192 public immutable defaultThreshold; // {%} e.g. 0.1

    uint192 public immutable volatilityBuffer; // {%} e.r. 1

    uint192 public prevReferencePrice; // previous rate, {collateral/reference}

    AggregatorV3Interface public immutable chainlinkFeedFallback;

    /// @param maxTradeVolume_ {UoA} The max trade volume, in UoA
    /// @param maxTradeVolume_ {UoA} The max trade volume, in UoA
    /// @param oracleTimeout_ {s} The number of seconds until a oracle value becomes invalid
    /// @param delayUntilDefault_ {s} The number of seconds deviation must occur before default
    /// @dev a static fallbackPrice_ makes no sense so we set it to 0. 
    /// An alternative chainlink price feed will be used instead to calculate the fallback price
    constructor(
        uint192 fallbackPrice_,
        AggregatorV3Interface chainlinkFeed_, // stEth/usd 0xcfe54b5cd566ab89272946f602d76ea879cab4a8
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        uint48 oracleTimeout_,
        bytes32 targetName_,
        uint256 delayUntilDefault_,
        uint192 defaultThreshold_,
        AggregatorV3Interface chainlinkFeedFallback_, // eth/usd 0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419
        uint192 volatilityBuffer_ // allowance for samll losses since rEARN-stETH strategy has only 99.5% collateral protection

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
        require(address(chainlinkFeedFallback_) != address(0), "missing fallback chainlink feed");
        require(volatilityBuffer_ > 0, "volatilityBuffer zero");
        defaultThreshold = defaultThreshold_;
        chainlinkFeedFallback = chainlinkFeedFallback_;
        volatilityBuffer = volatilityBuffer_;
    }

    /// Refresh exchange rates and update default status.
    /// @dev This check assumes that the price of stEth 
    /// should not be much smaller than the price of Eth
    function refresh() external virtual override {
        if (alreadyDefaulted()) return;
        CollateralStatus oldStatus = status();

        // Check for hard default
        uint192 referencePrice = refPerTok();
        // uint192(<) is equivalent to Fix.lt
        if (referencePrice < prevReferencePrice) {
            markStatus(CollateralStatus.DISABLED);
        } else {
            // since there is no eth/stEth price feed, we have to use two 
            // oracle feeds, here we check both of them
            try chainlinkFeed.price_(oracleTimeout) returns (uint192 p) {
                try chainlinkFeedFallback.price_(oracleTimeout) returns (uint192 fp) {

                    // same as targetPerRef() but since we have to check
                    // integrity of price feed above in try-catch, 
                    // we avoid calling targetPerRef() to optimize on gas
                    // p == stEth/usd, fp == eth/usd
                    uint192 tPerRef = p.div(fp);

                    // we check for depeg of stEth from Eth for collateral status
                    if (tPerRef < (FIX_ONE - defaultThreshold) ) {
                        markStatus(CollateralStatus.IFFY);
                    } else {
                        markStatus(CollateralStatus.SOUND);
                    }

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
    }

    /// @return {target/ref} Quantity of whole target units per whole reference unit (Eth/stEth)
    function targetPerRef() public view override returns (uint192) {
        uint192 uoaPerRef = chainlinkFeed.price(oracleTimeout); // stEth / usd feed
        uint192 uoaPerTarget = pricePerTarget(); // Eth / usd feed
        // == {UoA/ref} / {UoA/target}
        // == {UoA/ref} * {target/UoA}
        // == {target/ref}
        return uoaPerRef.div(uoaPerTarget);  
    }

    /// @return {UoA/target} The price of a target unit in UoA (Eth/usd)
    function pricePerTarget() public view override returns (uint192) {
        return chainlinkFeedFallback.price(oracleTimeout);
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral token
    /// rEARN-stEth has 18 decimals
    function refPerTok() public view override returns (uint192) {
        uint256 pricePerShare = IrEARN(address(erc20)).pricePerShare();
        int8 shiftLeft = -18;
        return shiftl_toFix(pricePerShare, shiftLeft);
    }

    /// Can return 0, can revert
    /// @return {UoA/tok} The current price()
    /// we cancel out ref to get {UoA/tok}
    function strictPrice() public view override returns (uint192) {
        uint192 uoaPerRef = chainlinkFeed.price(oracleTimeout); // stEth/usd
        return uoaPerRef.mul(refPerTok());
    }

    /// Can return 0
    /// Cannot revert if `allowFallback` is true. Can revert if false.
    /// @param allowFallback Whether to try the fallback price in case precise price reverts
    /// @return isFallback If the price is a allowFallback price
    /// @return {UoA/tok} The current price, or if it's reverting, a fallback price
    function price(bool allowFallback) public view virtual returns (bool isFallback, uint192) {
        try this.strictPrice() returns (uint192 p) {
            return (false, p);
        } catch {
            require(allowFallback, "price reverted without failover enabled");
            // we use Eth price instead of stEth price as fallback here
            uint192 uoaPerTarget = chainlinkFeedFallback.price(oracleTimeout);
            return (true, uoaPerTarget.mul(refPerTok()));
        }
    }
}