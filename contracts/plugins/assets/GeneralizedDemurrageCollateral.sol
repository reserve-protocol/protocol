// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "../../interfaces/IAsset.sol";
import "./Asset.sol";

struct DemurrageConfig {
    bytes32 targetName;
    uint192 fee; // {1/s} per-second inflation/deflation of refPerTok/targetPerRef
    //
    AggregatorV3Interface feed0; // {UoA/tok} or {target/tok}
    AggregatorV3Interface feed1; // empty or {UoA/target}
    uint48 timeout0; // {s}
    uint192 error0; // {1}
    uint48 timeout1; // {s}
    uint192 error1; // {1}
    //
    bool isFiat;
}

/**
 * @title GeneralizedDemurrageCollateral
 * @notice Collateral plugin for a genneralized demurrage collateral (/w management fee)
 *
 * refPerTok() * targetPerRef() = refPerTokt0 * targetPerReft0, within precision
 *
 * refPerTok is artificially up-only
 * targetPerRef is artificially down-only
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
 * - ref = Inflationary X
 * - target = X
 * - UoA = USD
 */
contract GeneralizedDemurrageCollateral is ICollateral, Asset {
    using FixLib for uint192;
    using OracleLib for AggregatorV3Interface;

    // === Old stuff ===

    CollateralStatus public immutable status = CollateralStatus.SOUND; // never default
    bytes32 public immutable targetName;
    uint192 public savedPegPrice; // {target/ref} The peg price of the token during the last update

    // === New stuff ===

    bool internal immutable isFiat;

    // For each token, we maintain up to two feeds/timeouts/errors
    AggregatorV3Interface internal immutable feed0; // {UoA/tok} or {target/tok}
    AggregatorV3Interface internal immutable feed1; // empty or {UoA/target}
    uint48 internal immutable timeout0; // {s}
    uint48 internal immutable timeout1; // {s}
    uint192 internal immutable error0; // {1}
    uint192 internal immutable error1; // {1}

    uint48 public immutable t0; // {s} deployment timestamp
    uint192 public immutable fee; // {1/s} demurrage fee; manifests as reference unit inflation

    /// @param priceTimeout_ {s} The number of seconds over which savedHighPrice decays to 0
    /// @param maxTradeVolume_ {UoA} The max trade volume, in UoA
    /// @param oracleTimeout_ {s} The number of seconds until the chainlinkFeed becomes invalid
    /// @param demurrageConfig.decay_ {1/s} fraction of the reference unit to inflate each second
    /// @param demurrageConfig.feed0_ {UoA/tok} or {target/tok}
    /// @param demurrageConfig.feed1_ empty or {UoA/target}
    /// @param demurrageConfig.isFiat_ true iff {target} == {UoA}
    constructor(
        uint48 priceTimeout_,
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        uint48 oracleTimeout_,
        DemurrageConfig memory demurrageConfig
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
        targetName = demurrageConfig.targetName;
        isFiat = demurrageConfig.isFiat;

        require(address(demurrageConfig.feed0) != address(0), "missing feed0");
        require(demurrageConfig.timeout0 != 0, "missing timeout0");
        require(demurrageConfig.error0 > 0 && demurrageConfig.error0 < FIX_ONE, "bad error0");

        if (address(demurrageConfig.feed1) != address(0)) {
            require(demurrageConfig.timeout1 != 0, "missing timeout1");
            require(demurrageConfig.error1 > 0 && demurrageConfig.error1 < FIX_ONE, "bad error1");
        }

        feed0 = demurrageConfig.feed0;
        feed1 = demurrageConfig.feed1;
        timeout0 = demurrageConfig.timeout0;
        timeout1 = demurrageConfig.timeout1;
        error0 = demurrageConfig.error0;
        error1 = demurrageConfig.error1;

        t0 = uint48(block.timestamp);
        fee = demurrageConfig.fee;
    }

    /// Can revert, used by other contract functions in order to catch errors
    /// Should NOT be manipulable by MEV
    /// @return low {UoA/tok} The low price estimate
    /// @return high {UoA/tok} The high price estimate
    /// @return pegPrice {target/ref} The actual price observed in the peg
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
        uint192 x = feed0.price(timeout0); // initially {UoA/tok}
        uint192 xErr = error0;

        // Use only 1 feed if 2nd feed not defined; else multiply together
        // if only 1 feed: `y` is FIX_ONE and `yErr` is 0

        uint192 y = FIX_ONE;
        uint192 yErr;
        if (address(feed1) != address(0)) {
            y = feed1.price(timeout1); // {UoA/target}
            yErr = error1;

            // {target/ref} = {target/tok} / {ref/tok}
            pegPrice = x.mul(_feeSinceT0(), FLOOR);
        } else if (isFiat) {
            // apply issuance premium for fiat collateral since target == UoA

            // {target/ref} = {UoA/ref} = {UoA/tok} / {ref/tok}
            pegPrice = x.mul(_feeSinceT0(), FLOOR);
        }

        // {UoA/tok} = {UoA/ref} * {ref/tok}
        low = x.mul(FIX_ONE - xErr).mul(y.mul(FIX_ONE - yErr), FLOOR);
        high = x.mul(FIX_ONE + xErr).mul(y.mul(FIX_ONE + yErr), CEIL);
        assert(low <= high);
    }

    // === Demurrage rates ===

    // usually targetPerRef() is constant -- in a demurrage collateral the product
    //   refPerTok() * targetPerRef() is kept (roughly) constant

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function refPerTok() public view override returns (uint192) {
        // up-only
        return FIX_ONE.div(_feeSinceT0(), FLOOR);
    }

    /// @return {target/ref} Quantity of whole target units per whole reference unit in the peg
    function targetPerRef() public view override returns (uint192) {
        // down-only
        return _feeSinceT0();
    }

    /// @return If the asset is an instance of ICollateral or not
    function isCollateral() external pure override(Asset, IAsset) returns (bool) {
        return true;
    }

    // === Internal ===

    /// @return {1} The overall fee since t0
    function _feeSinceT0() internal view returns (uint192) {
        // 1 - (1 - decay)^(block.timestamp - t0)
        return FIX_ONE.minus(FIX_ONE.minus(fee).powu(uint48(block.timestamp - t0)));
    }
}
