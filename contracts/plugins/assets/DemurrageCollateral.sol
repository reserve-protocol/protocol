// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "./FiatCollateral.sol";

struct DemurrageConfig {
    uint192 fee; // {1/s} per-second deflation of the target unit
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
 * Warning: Do NOT use the standard targetName() format
 * - Use: DMR{annual_demurrage_in_basis_points}{token_symbol}
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
 * - ref = Decayed X (since 2024-01-01 00:00:00 GMT+0000)
 * - target = Decayed X (since 2024-01-01 00:00:00 GMT+0000)
 * - UoA = USD
 */
contract DemurrageCollateral is FiatCollateral {
    using FixLib for uint192;
    using OracleLib for AggregatorV3Interface;

    uint48 public constant T0 = 1704067200; // {s} Jan 1st 2024 00:00:00 GMT+0000

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
    uint192 public fee; // {1/s} demurrage fee; target unit deflation

    /// @param config.chainlinkFeed => feed0: {UoA/tok} or {target/tok}
    /// @param config.oracleTimeout => timeout0
    /// @param config.oracleError => error0
    /// @param demurrageConfig.feed1 empty or {UoA/target}
    /// @param demurrageConfig.isFiat true iff {target} == {UoA}
    /// @param demurrageConfig.targetUnitfeed0 true iff feed0 is {target/tok} units
    /// @param demurrageConfig.fee {1/s} fraction of the target unit to deflate each second
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

        fee = demurrageConfig.fee;
    }

    /// Can revert, used by other contract functions in order to catch errors
    /// Should NOT be manipulable by MEV
    /// @return low {UoA/tok} The low price estimate
    /// @return high {UoA/tok} The high price estimate
    /// @return pegPrice {target/tok} The un-decayed pegPrice
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
        // demurrage fee.
        //
        // The pegPrice should not account for demurrage

        pegPrice = FIX_ONE; // undecayed rate that won't trigger default or issuance premium

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
        // Monotonically increasing due to target unit (and reference unit) deflation

        uint192 denominator = FIX_ONE.minus(fee).powu(uint48(block.timestamp - T0));
        if (denominator == 0) return FIX_MAX; // TODO

        // up-only
        return FIX_ONE.div(denominator, FLOOR);
    }
}
