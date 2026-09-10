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
 * =====================================================================================
 * DO NOT DEPLOY. NOT PRODUCTION READY.
 * =====================================================================================
 * This plugin is deliberately not deployable: there are no deployment or Etherscan
 * verification scripts for it, and it is not referenced by scripts/deploy.ts or
 * scripts/verify_etherscan.ts. It is kept in-tree as a reference implementation only.
 * Do NOT register it in an RToken's AssetRegistry.
 *
 * Reason 1 -- the price source is cheaply manipulable.
 *   All mainnet MORPHO liquidity is ~$126k, and the deepest TWAP-capable venue (the Uniswap V3
 *   0.30% MORPHO/WETH pool) holds only ~$62k. `docs/collateral.md` requires that an oracle not
 *   be manipulable *cheaply*; a 30-minute TWAP over a pool that thin does not clear that bar,
 *   even though it is not manipulable within a single block.
 *
 * Reason 2 -- `maxTradeVolume` does NOT bound true-value exposure, and makes it worse.
 *   `TradeLib.maxTradeSize()` sizes a lot as `maxTradeVolume / sellHigh`, i.e. denominated in
 *   *this plugin's own reported price*. If an attacker pushes the TWAP down by a factor k, the
 *   lot grows as 1/k, so the true value sold grows as 1/k -- while the minimum proceeds are
 *   `maxTradeVolume * (1 - oracleError) * (1 - maxTradeSlippage) / (1 + oracleError)`, which is
 *   INDEPENDENT of k. With $10k maxTradeVolume, 10% oracleError and 1% maxTradeSlippage that
 *   floor is ~$8.1k whether the price is honest, halved, or down 10x; only the quantity of
 *   MORPHO handed over grows. The effective ceiling is therefore the entire held balance, not
 *   maxTradeVolume. Revenue auctions are permissionless, so the attacker both moves the TWAP
 *   and bids. No parameter value fixes this: lowering maxTradeVolume scales both sides equally.
 *
 *   Every other plugin is safe here because its price bottoms out in a Chainlink feed that a
 *   bidder cannot move, which is the assumption TradeLib's sizing relies on. This is a plugin
 *   violating that precondition, not a flaw in TradeLib.
 *
 * Before this could ship, sizing must stop depending on a manipulable price -- e.g. an
 * oracle-independent cap on token quantity or aggregate exposure, or a price source that meets
 * the "not cheaply manipulable" bar.
 *
 * Note: as of 2026-09, none of the eight Morpho Vault V2 vaults emit MORPHO at all, so nothing
 * is currently forgone by not deploying this.
 *
 * Operational prerequisite (if the above is ever resolved):
 *   The pool's `observationCardinality` MUST retain `twapWindow` seconds of observations, or
 *   `observe()` reverts ("OLD") and this Asset becomes unpriced. Covering `twapWindow` needs
 *   `twapWindow / blockTime + 1` observations; grow it permissionlessly and with headroom via
 *   `increaseObservationCardinalityNext()` well in advance, as cardinality only rises as new
 *   observations are written.
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
