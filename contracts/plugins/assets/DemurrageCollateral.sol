// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "./FiatCollateral.sol";

struct DemurrageConfig {
    uint192 fee; // {1/s} per-second inflation/deflation of refPerTok/targetPerRef
    //
    bool isFiat; // if true: {target} == {UoA}
    bool targetUnitFeed0; // if true: feed0 is {target/tok}
    //
    // optional extra feed
    AggregatorV3Interface feed1; // empty or {UoA/target}
    uint48 timeout1; // {s}
    uint192 error1; // {1}
}

/**
 * @title DemurrageCollateral
 * @notice Collateral plugin for a genneralized demurrage collateral (i.e /w management fee)
 * Warning: Do NOT use the standard targetName() format of "USD"
 *
 * DemurrageCollateral's targetName() must be contain 3 dimensions:
 *   1. date
 *   2. unit
 *   3. annual rate
 * For example: 20241017USD50% describes a USD peg of $1 on 2024-10-17 and $0.50 on 2025-10-17.
 * An RToken looking to put this collateral into its basket on 2025-10-17 would use 2 units,
 * if the intent were to achieve $1 in _today's_ dollars.
 *
 * under 1 feed:
 *   - feed0/chainlinkFeed must be {UoA/tok}
 *   - apply issuance premium IFF isFiat is true
 * 2 feeds:
 *   - feed0: targetUnitFeed0 ? {target/tok} : {UoA/tok}
 *   - feed1: {UoA/target}
 *   - apply issuance premium
 *
 * - tok = Tokenized X
 * - ref = Virtually inflationary X
 * - target = YYYYMMDD-X-APR%
 * - UoA = USD
 */
contract DemurrageCollateral is FiatCollateral {
    using FixLib for uint192;
    using OracleLib for AggregatorV3Interface;

    bool internal immutable isFiat;
    bool internal immutable targetUnitFeed0; // if true: feed0 is {target/tok}

    // up to 2 feeds/timeouts/errors
    AggregatorV3Interface internal immutable feed0; // targetUnitFeed0 ? {target/tok} : {UoA/tok}
    AggregatorV3Interface internal immutable feed1; // empty or {UoA/target}
    uint48 internal immutable timeout0; // {s}
    uint48 internal immutable timeout1; // {s}
    uint192 internal immutable error0; // {1}
    uint192 internal immutable error1; // {1}

    // immutable in spirit -- cannot be because of FiatCollateral's targetPerRef() call
    // TODO would love to find a way to make these immutable for gas reasons
    uint48 public t0; // {s} deployment timestamp
    uint192 public fee; // {1/s} demurrage fee; manifests as reference unit inflation

    /// @param config.chainlinkFeed => feed0: {UoA/tok} or {target/tok}
    /// @param config.oracleTimeout => timeout0
    /// @param config.oracleError => error0
    /// @param demurrageConfig.feed1 empty or {UoA/target}
    /// @param demurrageConfig.isFiat true iff {target} == {UoA}
    /// @param demurrageConfig.targetUnitfeed0 true iff feed0 is {target/tok} units
    /// @param demurrageConfig.fee {1/s} fraction of the reference unit to inflate each second
    constructor(CollateralConfig memory config, DemurrageConfig memory demurrageConfig)
        FiatCollateral(config)
    {
        isFiat = demurrageConfig.isFiat;
        targetUnitFeed0 = demurrageConfig.targetUnitFeed0;

        if (demurrageConfig.feed1 != AggregatorV3Interface(address(0))) {
            require(demurrageConfig.timeout1 != 0, "missing timeout1");
            require(demurrageConfig.error1 > 0 && demurrageConfig.error1 < FIX_ONE, "bad error1");
        } else {
            require(!demurrageConfig.targetUnitFeed0, "missing UoA info");
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
    /// @return pegPrice {target/tok} The undecayed price observed in the peg
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
        // This plugin handles pegPrice differently than most -- since FiatCollateral saves
        // valid peg ranges at deployment time, they do not account for the decay due to the
        // demurrage fee
        //
        // To account for this, the pegPrice is returned in units of {target/tok}
        // aka {target/ref} without the reference unit inflation

        pegPrice = FIX_ONE; // uninflated rate that won't trigger default or issuance premium

        uint192 x = feed0.price(timeout0); // {UoA/tok}
        uint192 xErr = error0;

        low = x.mul(FIX_ONE - xErr); // {UoA/tok}
        high = x.mul(FIX_ONE + xErr); // {UoA/tok}

        if (address(feed1) != address(0)) {
            if (targetUnitFeed0) {
                pegPrice = x; // {target/tok}

                uint192 y = feed1.price(timeout1); // {UoA/target}
                uint192 yErr = error1;

                // Multiply x and y
                low = low.mul(y.mul(FIX_ONE - yErr), FLOOR);
                high = high.mul(y.mul(FIX_ONE + yErr), CEIL);
            } else {
                // {target/tok} = {UoA/tok} / {UoA/target}
                pegPrice = x.div(feed1.price(timeout1), ROUND);
            }
        } else if (isFiat) {
            // {target/tok} = {UoA/tok} because {target} == {UoA}
            pegPrice = x;
        }

        assert(low <= high);
    }

    // === Demurrage rates ===

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function refPerTok() public view override returns (uint192) {
        uint192 denominator = FIX_ONE.minus(fee).powu(uint48(block.timestamp - t0));
        if (denominator == 0) return FIX_MAX;

        // up-only
        return FIX_ONE.div(denominator, FLOOR);
    }
}
