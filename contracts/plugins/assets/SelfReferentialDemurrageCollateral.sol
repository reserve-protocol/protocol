// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "../../interfaces/IAsset.sol";
import "./Asset.sol";

struct DemurrageConfig {
    bytes32 targetName;
    uint192 decay; // {1/s} fraction of the target unit to decay each second
    //
    AggregatorV3Interface feed0;
    AggregatorV3Interface feed1;
    uint48 timeout0; // {s}
    uint192 error0; // {1}
    uint48 timeout1; // {s}
    uint192 error1; // {1}
}

/**
 * @title SelfReferentialDemurrageCollateral
 * @notice Collateral plugin for a self-referential demurrage collateral, i.e /w a management fee
 *
 * No default detection
 * Demurrage collateral implement a management fee in the form of a decaying exponential
 *
 * refPerTok = up-only
 * targetPerRef = down-only
 * product = constant
 *
 * If 1 feed:
 *   - feed0 must be {UoA/tok}
 *   - does not implement issuance premium
 * If 2 feeds:
 *   - feed0 must be {target/tok}
 *   - feed1 must be {UoA/target}
 *   - implements issuance premium
 *
 * t0 = a previous (or current) moment in time, used as reference for the decay
 *
 * For Target Unit X:
 * - tok = Tokenized X
 * - ref = X @ t0 /w decay
 * - target = X
 * - UoA = USD
 */
contract SelfReferentialDemurrageCollateral is ICollateral, Asset {
    using FixLib for uint192;
    using OracleLib for AggregatorV3Interface;

    // === Old stuff ===

    CollateralStatus public immutable status = CollateralStatus.SOUND; // never default
    bytes32 public immutable targetName;
    uint192 public savedPegPrice; // {target/ref} The peg price of the token during the last update

    // === New stuff ===

    uint48 public immutable t0; // {s} deployment timestamp
    uint192 public immutable decay; // {1/s} fraction of the target unit to decay each second

    // For each token, we maintain up to two feeds/timeouts/errors
    // The data below would normally be a struct, but we want bytecode substitution

    AggregatorV3Interface internal immutable feed0; // {UoA/tok} or {target/tok}
    AggregatorV3Interface internal immutable feed1; // empty or {UoA/target}
    uint48 internal immutable timeout0; // {s}
    uint48 internal immutable timeout1; // {s}
    uint192 internal immutable error0; // {1}
    uint192 internal immutable error1; // {1}

    bool internal immutable targetIsUoA;

    /// @param priceTimeout_ {s} The number of seconds over which savedHighPrice decays to 0
    /// @param maxTradeVolume_ {UoA} The max trade volume, in UoA
    /// @param oracleTimeout_ {s} The number of seconds until the chainlinkFeed becomes invalid
    constructor(
        uint48 priceTimeout_,
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        uint48 oracleTimeout_,
        DemurrageConfig memory demurrageConfig,
        bool targetIsUoA_
    )
        Asset(
            priceTimeout_,
            demurrageConfig.feed0,
            demurrageConfig.error0,
            erc20_,
            maxTradeVolume_,
            oracleTimeout_
        )
    {
        require(address(demurrageConfig.feed0) != address(0), "missing feed0");
        require(demurrageConfig.timeout0 != 0, "missing timeout0");
        require(demurrageConfig.error0 > 0 && demurrageConfig.error0 < FIX_ONE, "bad error0");

        if (address(demurrageConfig.feed1) != address(0)) {
            require(demurrageConfig.timeout1 != 0, "missing timeout1");
            require(demurrageConfig.error1 > 0 && demurrageConfig.error1 < FIX_ONE, "bad error1");
        }

        t0 = uint48(block.timestamp);
        decay = demurrageConfig.decay;
        feed0 = demurrageConfig.feed0;
        feed1 = demurrageConfig.feed1;
        timeout0 = demurrageConfig.timeout0;
        timeout1 = demurrageConfig.timeout1;
        error0 = demurrageConfig.error0;
        error1 = demurrageConfig.error1;

        targetName = demurrageConfig.targetName;
        targetIsUoA = targetIsUoA_;
    }

    /// Can revert, used by other contract functions in order to catch errors
    /// Should NOT be manipulable by MEV
    /// @return low {UoA/tok} The low price estimate
    /// @return high {UoA/tok} The high price estimate
    /// @return pegPrice {target/ref} The actual price observed in the peg
    ///         unused if only 1 feed
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
        uint192 x = feed0.price(timeout0);
        uint192 xErr = error0;

        // Use only 1 feed if 2nd feed not defined; else multiply together
        // if only 1 feed: `y` is FIX_ONE and `yErr` is 0

        uint192 y = FIX_ONE;
        uint192 yErr;
        if (address(feed1) != address(0)) {
            y = feed1.price(timeout1); // {target/tok}
            yErr = error1;

            // {target/ref} = {target/tok} / {ref/tok}
            pegPrice = y.mul(_decay(), FLOOR);
        } else if (targetIsUoA) {
            // {target/ref} = {UoA/ref} = {UoA/tok} / {ref/tok}
            pegPrice = x.mul(_decay(), FLOOR);
        }

        // {UoA/tok} = {UoA/ref} * {ref/tok}
        low = x.mul(FIX_ONE - xErr).mul(y.mul(FIX_ONE - yErr), FLOOR);
        high = x.mul(FIX_ONE + xErr).mul(y.mul(FIX_ONE + yErr), CEIL);
        // assert(low <= high); obviously true just by inspection
    }

    // === Demurrage rates ===

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function refPerTok() public view override returns (uint192) {
        // up-only
        return FIX_ONE.div(_decay(), FLOOR);
    }

    /// @return {target/ref} Quantity of whole target units per whole reference unit in the peg
    function targetPerRef() public view override returns (uint192) {
        // down-only
        return _decay();
    }

    /// @return If the asset is an instance of ICollateral or not
    function isCollateral() external pure override(Asset, IAsset) returns (bool) {
        return true;
    }

    // === Internal ===

    /// @return {1} The decay since t0
    function _decay() internal view returns (uint192) {
        // 1 - (1 - decay)^(block.timestamp - t0)
        return FIX_ONE.minus(FIX_ONE.minus(decay).powu(uint48(block.timestamp - t0)));
    }
}
