// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "../../libraries/Fixed.sol";
import "./AbstractCollateral.sol";
import "./IrEARN.sol";

/**
 * @title RibbonEarnStEthCollateral
 * @notice Collateral plugin for the Ribbon Earn stEth Vault
 * Expected:
 * {tok} == rEARN-stEth
 * {ref} == stEth
 * {target} == ETH
 * {UoA} == USD
 * {ref} is pegged to {target} or defaults
 */
contract RibbonEarnStEthCollateral is Collateral {
    using FixLib for uint192;
    using OracleLib for AggregatorV3Interface;

    uint192 public immutable defaultThreshold; // {%} e.g. 0.1

    uint192 public immutable volatilityBuffer; // {%} e.g. 0.02

    uint192 public prevReferencePrice; // previous rate, {collateral/reference}

    uint192 public highestObservedReferencePrice;

    AggregatorV3Interface public immutable chainlinkFeedFallback;

    /// @param fallbackPrice_ static fallback price makes no sense so it is not used. Can't
    /// be 0. Can be set to 1.
    /// @param chainlinkFeed_ stEth/usd mainnet: 0xcfe54b5cd566ab89272946f602d76ea879cab4a8
    /// @param erc20_ rEARN-stETH mainnet: 0xCE5513474E077F5336cf1B33c1347FDD8D48aE8c
    /// @param maxTradeVolume_ {UoA} The max trade volume, in UoA
    /// @param oracleTimeout_ {s} The number of seconds until a oracle value becomes invalid
    /// @param targetName_ bytes32 formatted string of target symbol (ETH)
    /// @param delayUntilDefault_ {s} The number of seconds deviation must occur before default
    /// @param defaultThreshold_ {%} maximum tolerated negative deviation of ref (stEth)
    /// from target (Eth). E.g. 0.05
    /// @param chainlinkFeedFallback_ eth/usd mainnet: 0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419
    /// @param volatilityBuffer_ {%} since the underlying rEARN-stETH strategy is 99.5% capital
    /// protected, we don't want the collateral to default during temporary drawdown.
    /// volatilityBuffer_ defines the amount of revenue we will hide from the protocol in order
    /// to avoid default up to this limit. However, due to how Reserve Protocol works, this
    /// value has to be rather small. E.g. 0.02 - equates to four bad trades in a row.
    constructor(
        uint192 fallbackPrice_,
        AggregatorV3Interface chainlinkFeed_,
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        uint48 oracleTimeout_,
        bytes32 targetName_,
        uint256 delayUntilDefault_,
        uint192 defaultThreshold_,
        AggregatorV3Interface chainlinkFeedFallback_,
        uint192 volatilityBuffer_
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
        // Here we compare the volatility adjusted reference price
        // with the actual price
        uint192 referencePrice = pricePerShare();

        // We keep a record of the highest observed price.
        // Needed to calculate refPerTok() to implement revenue hiding
        highestObservedReferencePrice < referencePrice
            ? highestObservedReferencePrice = referencePrice
            : highestObservedReferencePrice;

        // uint192(<) is equivalent to Fix.lt
        // if true - hard default, else check for soft default
        if (referencePrice < prevReferencePrice) {
            markStatus(CollateralStatus.DISABLED);
        } else {
            // since there is no eth/stEth price feed, we have to use two
            // oracle feeds. here we check both of them
            try chainlinkFeed.price_(oracleTimeout) returns (uint192 p) {
                try chainlinkFeedFallback.price_(oracleTimeout) returns (uint192 fp) {
                    // we get actual {target/ref} from the oracle prices.
                    // we cannot use targetPerRef() here since that is a constant
                    // p == stEth/usd, fp == eth/usd
                    uint192 tPerRef = p.div(fp);

                    // we check for depeg of stEth from Eth for collateral status decision.
                    // we avoid calling targetPerRef()(== 1) for gas optimization
                    if (tPerRef < (FIX_ONE - defaultThreshold)) {
                        markStatus(CollateralStatus.IFFY);
                    } else {
                        markStatus(CollateralStatus.SOUND);
                    }

                    // if either oracle feed is bad, status is set to IFFY
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

        // same as calling refPerTok() but we save one external contract call
        // by reusing pricePerShare() from above
        uint192 ref;
        referencePrice < highestObservedReferencePrice
            ? ref = highestObservedReferencePrice
            : ref = referencePrice;
        uint192 rpt = ref - ref.mul(volatilityBuffer);

        // we set prevReferencePrice to refPerTok if it is bigger than
        // previosReferncePrice
        rpt > prevReferencePrice ? prevReferencePrice = rpt : prevReferencePrice;

        // if collateral status has changed we emit the event
        CollateralStatus newStatus = status();
        if (oldStatus != newStatus) {
            emit CollateralStatusChanged(oldStatus, newStatus);
        }
    }

    /// @return {UoA/target} The price of a target unit in UoA (Eth/usd)
    function pricePerTarget() public view override returns (uint192) {
        return chainlinkFeedFallback.price(oracleTimeout);
    }

    /// @return pricePerShare of rEARN-sTEth in Eth as Fix uint192
    /// rEARN-stEth has 18 decimals
    function pricePerShare() public view returns (uint192) {
        uint256 pps = IrEARN(address(erc20)).pricePerShare();
        int8 shiftLeft = -18;
        return shiftl_toFix(pps, shiftLeft);
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral token
    /// we are hiding volatilityBuffer {%} of revenue to account for volatility
    /// rEARN-stEth has 18 decimals
    function refPerTok() public view override returns (uint192) {
        uint192 pps = pricePerShare();
        uint192 p;
        pps < highestObservedReferencePrice ? p = highestObservedReferencePrice : p = pps;
        return p - p.mul(volatilityBuffer);
    }

    /// Can return 0, can revert
    /// @return {UoA/tok} The current price()
    /// we cancel out ref to get {UoA/tok}
    function strictPrice() public view override returns (uint192) {
        uint192 uoaPerRef = chainlinkFeed.price(oracleTimeout); // stEth/usd
        return uoaPerRef.mul(pricePerShare());
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
            // alternative more accurate fallback price but more costly and
            // not robust if both oracle feeds fail at the same time
            // uint192 uoaPerTarget = chainlinkFeedFallback.price(oracleTimeout);
            // return (true, uoaPerTarget.mul(pricePerShare()));
            // so we return highestObservedReferencePrice instead as fallback
            return (true, highestObservedReferencePrice);
        }
    }
}
