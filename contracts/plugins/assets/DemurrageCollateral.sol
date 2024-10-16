// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "./FiatCollateral.sol";

struct DemurrageConfig {
    bool isFiat;
    uint192 fee; // {1/s} per-second inflation/deflation of refPerTok/targetPerRef
    //
    // optional extra feed
    AggregatorV3Interface feed1; // empty or {UoA/target}
    uint48 timeout1; // {s}
    uint192 error1; // {1}
}

/**
 * @title DemurrageCollateral
 * @notice Collateral plugin for a genneralized demurrage collateral (i.e /w management fee)
 *
 * 1 feed:
 *   - feed0 {UoA/tok}
 *   - apply issuance premium IFF isFiat is true
 * 2 feeds:
 *   - feed0 {target/tok}
 *   - feed1 {UoA/target}
 *   - apply issuance premium using feed0
 *
 * - tok = Tokenized X
 * - ref = Virtual (inflationary) X
 * - target = X
 * - UoA = USD
 */
contract DemurrageCollateral is FiatCollateral {
    using FixLib for uint192;
    using OracleLib for AggregatorV3Interface;

    bool internal immutable isFiat;

    // For each token, we maintain up to two feeds/timeouts/errors
    AggregatorV3Interface internal immutable feed0; // {UoA/tok} or {target/tok}
    AggregatorV3Interface internal immutable feed1; // empty or {UoA/target}
    uint48 internal immutable timeout0; // {s}
    uint48 internal immutable timeout1; // {s}
    uint192 internal immutable error0; // {1}
    uint192 internal immutable error1; // {1}

    // immutable in spirit -- cannot be because of FiatCollateral's targetPerRef() call
    // TODO would love to find a way to make these immutable
    uint48 public t0; // {s} deployment timestamp
    uint192 public fee; // {1/s} demurrage fee; manifests as reference unit inflation

    /// @param config.chainlinkFeed unused
    /// @param config.oracleTimeout unused
    /// @param config.oracleError unused
    /// @param demurrageConfig.fee {1/s} fraction of the reference unit to inflate each second
    /// @param demurrageConfig.feed0 {UoA/tok} or {target/tok}
    /// @param demurrageConfig.feed1 empty or {UoA/target}
    /// @param demurrageConfig.isFiat true iff {target} == {UoA}
    constructor(CollateralConfig memory config, DemurrageConfig memory demurrageConfig)
        FiatCollateral(config)
    {
        isFiat = demurrageConfig.isFiat;

        if (demurrageConfig.feed1 != AggregatorV3Interface(address(0))) {
            require(demurrageConfig.timeout1 != 0, "missing timeout1");
            require(demurrageConfig.error1 > 0 && demurrageConfig.error1 < FIX_ONE, "bad error1");
        }

        feed0 = config.chainlinkFeed;
        feed1 = demurrageConfig.feed1;
        timeout0 = config.oracleTimeout;
        timeout1 = demurrageConfig.timeout1;
        error0 = config.oracleError;
        error1 = demurrageConfig.error1;

        t0 = uint48(block.timestamp);
        fee = demurrageConfig.fee;
    }

    /// Can revert, used by other contract functions in order to catch errors
    /// Should NOT be manipulable by MEV
    /// @return low {UoA/tok} The low price estimate
    /// @return high {UoA/tok} The high price estimate
    /// @return pegPrice {target/ref} The unadjusted price observed in the peg
    ///                               can be 0 if only 1 feed AND not fiat
    function tryPrice()
        external
        view
        override
        returns (
            uint192 low,
            uint192 high,
            uint192 pegPrice
        )
    {
        pegPrice = FIX_ONE; // undecayed rate that won't trigger default or issuance premium

        // Use only 1 feed if 2nd feed not defined; else multiply together
        // if only 1 feed: `y` is FIX_ONE and `yErr` is 0

        uint192 x = feed0.price(timeout0); // initially {UoA/tok}
        uint192 xErr = error0;
        uint192 y = FIX_ONE;
        uint192 yErr;
        if (address(feed1) != address(0)) {
            y = feed1.price(timeout1); // {UoA/target}
            yErr = error1;

            // {target/ref} = {UoA/target}
            pegPrice = y; // no demurrage needed
        } else if (isFiat) {
            // {target/ref} = {UoA/tok}
            pegPrice = x; // no demurrage needed
        }

        // {UoA/tok} = {UoA/ref} * {ref/tok}
        low = x.mul(FIX_ONE - xErr).mul(y.mul(FIX_ONE - yErr), FLOOR);
        high = x.mul(FIX_ONE + xErr).mul(y.mul(FIX_ONE + yErr), CEIL);
        assert(low <= high);
    }

    // === Demurrage rates ===

    // invariant: targetPerRef() * refPerTok() ~= FIX_ONE

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function refPerTok() public view override returns (uint192) {
        // up-only
        return FIX_ONE.div(targetPerRef(), FLOOR);
    }

    /// @return {target/ref} Quantity of whole target units per whole reference unit in the peg
    function targetPerRef() public view override returns (uint192) {
        // down-only
        return FIX_ONE.minus(fee).powu(uint48(block.timestamp - t0));
    }
}
