// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.28;

// solhint-disable-next-line max-line-length
import { AggregatorV3Interface } from "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import { IERC20Metadata } from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import { FixLib, CEIL, FLOOR, shiftl_toFix } from "../../../libraries/Fixed.sol";
import { Asset } from "../Asset.sol";
import { OracleLib } from "../OracleLib.sol";
import { IUniswapV3Pool } from "./vendor/IUniswapV3Pool.sol";
import { UniswapV3TwapLib } from "./vendor/UniswapV3TwapLib.sol";

/**
 * @title MorphoAsset
 * @notice Asset plugin for the MORPHO reward token, which has no {UoA} price feed on mainnet.
 *
 * tok = MORPHO
 * UoA = USD
 *
 * MORPHO is earned as a reward by holding MetaMorpho / Morpho Vault V2 collateral. Rewards are
 * claimed off-chain via a Merkle proof, permissionlessly, on behalf of the RToken's Backing
 * Manager. This Asset exists only so the claimed MORPHO can be sold as revenue -- it is never
 * used as backing.
 *
 * Pricing: {UoA/tok} = {UoA/quoteTok} * {quoteTok/tok}
 *   - {UoA/quoteTok} comes from `chainlinkFeed` (e.g. ETH/USD)
 *   - {quoteTok/tok} comes from an arithmetic-mean-tick TWAP over `uniswapV3Pool`
 *
 * WARNING -- operational requirements for a safe deployment:
 *   1. The pool's `observationCardinality` MUST be large enough to retain `twapWindow` seconds of
 *      observations, or `observe()` reverts ("OLD") and this Asset becomes unpriced. Cardinality
 *      is grown permissionlessly via `increaseObservationCardinalityNext()` and never shrinks;
 *      the constructor probes the window once, but a pool that is traded in many consecutive
 *      blocks can still evict history later. Size cardinality with headroom.
 *   2. A TWAP is only as manipulation-resistant as the pool is deep. `maxTradeVolume` -- not the
 *      oracle -- is the binding protection here: a manipulated-downwards price lowers the
 *      DutchTrade floor, so cap per-auction exposure accordingly.
 */
contract MorphoAsset is Asset {
    using FixLib for uint192;
    using OracleLib for AggregatorV3Interface;
    using UniswapV3TwapLib for IUniswapV3Pool;

    /// The Uniswap V3 pool consulted for {quoteTok/tok}
    IUniswapV3Pool public immutable uniswapV3Pool;

    /// The token the pool prices `erc20` against; `chainlinkFeed` must be {UoA/quoteToken}
    address public immutable quoteToken;

    /// {s} The TWAP window over which the mean tick is taken
    uint32 public immutable twapWindow;

    /// {qTok} One whole unit of `erc20`, used as the TWAP base amount
    uint128 private immutable oneTok;

    /// The negated decimals of `quoteToken`, for converting the TWAP quote to a Fix
    int8 private immutable quoteTokenDecimals;

    /// @param priceTimeout_ {s} The number of seconds over which savedHighPrice decays to 0
    /// @param chainlinkFeed_ Feed units: {UoA/quoteToken} -- e.g. ETH/USD
    /// @param oracleError_ {1} The % the oracle feed can be off by
    /// @param erc20_ The MORPHO ERC20
    /// @param maxTradeVolume_ {UoA} The max trade volume, in UoA
    /// @param oracleTimeout_ {s} The number of seconds until the chainlinkFeed becomes invalid
    /// @param uniswapV3Pool_ The Uniswap V3 pool holding the erc20/quoteToken pair
    /// @param quoteToken_ The other token in the pool; must be the feed's base unit
    /// @param twapWindow_ {s} The TWAP window; longer is more manipulation-resistant
    constructor(
        uint48 priceTimeout_,
        AggregatorV3Interface chainlinkFeed_,
        uint192 oracleError_,
        IERC20Metadata erc20_,
        uint192 maxTradeVolume_,
        uint48 oracleTimeout_,
        IUniswapV3Pool uniswapV3Pool_,
        IERC20Metadata quoteToken_,
        uint32 twapWindow_
    ) Asset(priceTimeout_, chainlinkFeed_, oracleError_, erc20_, maxTradeVolume_, oracleTimeout_) {
        require(address(uniswapV3Pool_) != address(0), "missing pool");
        require(address(quoteToken_) != address(0), "missing quoteToken");
        require(address(quoteToken_) != address(erc20_), "quoteToken is erc20");
        require(twapWindow_ != 0, "twapWindow zero");

        // The pool must hold exactly the {erc20, quoteToken} pair, in either order
        address token0 = uniswapV3Pool_.token0();
        address token1 = uniswapV3Pool_.token1();
        require(
            (token0 == address(erc20_) && token1 == address(quoteToken_)) ||
                (token1 == address(erc20_) && token0 == address(quoteToken_)),
            "pool token mismatch"
        );

        uniswapV3Pool = uniswapV3Pool_;
        quoteToken = address(quoteToken_);
        twapWindow = twapWindow_;
        oneTok = uint128(10**erc20_.decimals());
        quoteTokenDecimals = int8(uint8(quoteToken_.decimals()));

        // Fail closed if the pool cannot currently serve the requested window
        uniswapV3Pool_.consult(twapWindow_);
    }

    /// Can revert, used by other contract functions in order to catch errors
    /// Should not return FIX_MAX for low
    /// Should only return FIX_MAX for high if low is 0
    /// Should NOT be manipulable by MEV
    /// @dev The third (unused) return value is only here for compatibility with Collateral
    /// @return low {UoA/tok} The low price estimate
    /// @return high {UoA/tok} The high price estimate
    function tryPrice()
        external
        view
        virtual
        override
        returns (
            uint192 low,
            uint192 high,
            uint192
        )
    {
        // {UoA/quoteTok}
        uint192 quoteTokenPrice = chainlinkFeed.price(oracleTimeout);

        // {quoteTok/tok}
        uint192 quoteTokPerTok = _twapQuoteTokPerTok();

        // {UoA/tok} = {UoA/quoteTok} * {quoteTok/tok}
        uint192 p = quoteTokenPrice.mul(quoteTokPerTok);
        uint192 err = p.mul(oracleError, CEIL);
        // assert(low <= high); obviously true just by inspection
        return (p - err, p + err, 0);
    }

    // === Private ===

    /// @return {quoteTok/tok} The TWAP price of one whole erc20 in quoteToken
    function _twapQuoteTokPerTok() private view returns (uint192) {
        int24 meanTick = uniswapV3Pool.consult(twapWindow);

        // {qQuoteTok} per one whole {tok}
        uint256 quoteAmount = UniswapV3TwapLib.getQuoteAtTick(
            meanTick,
            oneTok,
            address(erc20),
            quoteToken
        );

        // {quoteTok/tok} = {qQuoteTok} shifted by the quote token's decimals
        return shiftl_toFix(quoteAmount, -quoteTokenDecimals, FLOOR);
    }
}
