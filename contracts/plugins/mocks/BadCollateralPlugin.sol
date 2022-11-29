// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/plugins/assets/ATokenFiatCollateral.sol";

contract BadCollateralPlugin is ATokenFiatCollateral {
    using FixLib for uint192;
    using OracleLib for AggregatorV3Interface;

    bool public checkSoftDefault = true; // peg
    bool public checkHardDefault = true; // defi invariant

    /// @param fallbackPrice_ {UoA/tok} A fallback price to use for lot sizing when oracles fail
    /// @param chainlinkFeed_ Feed units: {UoA/ref}
    /// @param oracleError_ {1} The % the oracle feed can be off by
    /// @param maxTradeVolume_ {UoA} The max trade volume, in UoA
    /// @param oracleTimeout_ {s} The number of seconds until a oracle value becomes invalid
    /// @param defaultThreshold_ {%} A value like 0.05 that represents a deviation tolerance
    /// @param delayUntilDefault_ {s} The number of seconds deviation must occur before default
    constructor(
        uint192 fallbackPrice_,
        AggregatorV3Interface chainlinkFeed_,
        uint192 oracleError_,
        IStaticAToken erc20_,
        uint192 maxTradeVolume_,
        uint48 oracleTimeout_,
        bytes32 targetName_,
        uint192 defaultThreshold_,
        uint256 delayUntilDefault_
    )
        ATokenFiatCollateral(
            fallbackPrice_,
            chainlinkFeed_,
            oracleError_,
            erc20_,
            maxTradeVolume_,
            oracleTimeout_,
            targetName_,
            defaultThreshold_,
            delayUntilDefault_
        )
    {}

    function setSoftDefaultCheck(bool on) external {
        checkSoftDefault = on;
    }

    function setHardDefaultCheck(bool on) external {
        checkHardDefault = on;
    }

    /// Should not revert
    /// @param low {UoA/tok} The low price estimate
    /// @param high {UoA/tok} The high price estimate
    /// @param chainlinkFeedPrice {UoA/ref}
    function _price()
        internal
        view
        override
        returns (uint192 low, uint192 high, uint192 chainlinkFeedPrice)
    {
        try chainlinkFeed.price_(oracleTimeout) returns (uint192 p1) {
            // {UoA/tok} = {UoA/ref} * {ref/tok}
            uint192 p = p1.mul(refPerTok());

            // oracleError is on whatever the _true_ price is, not the one observed
            low = p.div(FIX_ONE.plus(oracleError));
            high = p.div(FIX_ONE.minus(oracleError));
            chainlinkFeedPrice = p1; // {UoA/ref}
        } catch (bytes memory errData) {
            // see: docs/solidity-style.md#Catching-Empty-Data
            if (errData.length == 0) revert(); // solhint-disable-line reason-string
            high = FIX_MAX;
        }
    }

    /// Should not revert
    /// Refresh exchange rates and update default status.
    function refresh() external override {
        if (alreadyDefaulted()) return;
        CollateralStatus oldStatus = status();

        uint192 referencePrice = refPerTok();
        // uint192(<) is equivalent to Fix.lt
        if (checkHardDefault && referencePrice < prevReferencePrice) {
            markStatus(CollateralStatus.DISABLED);
        } else if (checkSoftDefault) {
            (uint192 low, , uint192 p) = _price();

            // If the price is below the default-threshold price, default eventually
            // uint192(+/-) is the same as Fix.plus/minus
            if (low == 0 || p < pegBottom || p > pegTop) markStatus(CollateralStatus.IFFY);
            else {
                _fallbackPrice = low;
                markStatus(CollateralStatus.SOUND);
            }
        }
        prevReferencePrice = referencePrice;

        CollateralStatus newStatus = status();
        if (oldStatus != newStatus) {
            emit DefaultStatusChanged(oldStatus, newStatus);
        }
    }
}
