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

    /// Refresh exchange rates and update default status.
    function refresh() external virtual override {
        if (alreadyDefaulted()) return;
        CollateralStatus oldStatus = status();

        uint192 referencePrice = refPerTok();
        // uint192(<) is equivalent to Fix.lt
        if (checkHardDefault && referencePrice < prevReferencePrice) {
            markStatus(CollateralStatus.DISABLED);
        } else if (checkSoftDefault) {
            try chainlinkFeed.price_(oracleTimeout) returns (uint192 p) {
                // Check for soft default of underlying reference token
                // D18{UoA/ref} = D18{UoA/target} * D18{target/ref} / D18
                uint192 peg = (pricePerTarget() * targetPerRef()) / FIX_ONE;

                // D18{UoA/ref}= D18{UoA/ref} * D18{1} / D18
                uint192 delta = (peg * defaultThreshold) / FIX_ONE; // D18{UoA/ref}

                // If the price is below the default-threshold price, default eventually
                // uint192(+/-) is the same as Fix.plus/minus
                if (p < peg - delta || p > peg + delta) {
                    markStatus(CollateralStatus.IFFY);
                } else {
                    // {UoA/tok} = {UoA/ref} * {ref/tok}
                    _fallbackPrice = p.mul(refPerTok());

                    markStatus(CollateralStatus.SOUND);
                }
            } catch {
                markStatus(CollateralStatus.IFFY);
            }
        }
        prevReferencePrice = referencePrice;

        CollateralStatus newStatus = status();
        if (oldStatus != newStatus) {
            emit DefaultStatusChanged(oldStatus, newStatus);
        }
    }
}
