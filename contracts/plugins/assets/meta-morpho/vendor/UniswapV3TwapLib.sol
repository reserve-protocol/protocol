// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.28;

import { IUniswapV3Pool } from "./IUniswapV3Pool.sol";
import { TickMath } from "./TickMath.sol";
import { mulDiv256 } from "../../../../libraries/Fixed.sol";

/**
 * @title UniswapV3TwapLib
 * @notice Arithmetic-mean-tick TWAP consultation for a Uniswap V3 pool.
 *         Equivalent to the Uniswap V3 periphery OracleLibrary's `consult` + `getQuoteAtTick`,
 *         re-expressed for solidity 0.8.x and using this repo's 512-bit `mulDiv256` in place of
 *         Uniswap's FullMath.mulDiv.
 */
library UniswapV3TwapLib {
    /// @notice Arithmetic mean tick over the past `window` seconds
    /// @dev Reverts ("OLD") if the pool has not retained `window` seconds of observations.
    ///      Observation capacity is the pool's observationCardinality, which anyone can grow
    ///      via increaseObservationCardinalityNext().
    /// @param pool The Uniswap V3 pool to consult
    /// @param window {s} The TWAP window; must be nonzero
    /// @return meanTick The time-weighted arithmetic mean tick over the window
    function consult(IUniswapV3Pool pool, uint32 window) internal view returns (int24 meanTick) {
        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = window;
        secondsAgos[1] = 0;

        (int56[] memory tickCumulatives, ) = pool.observe(secondsAgos);
        int56 delta = tickCumulatives[1] - tickCumulatives[0];

        meanTick = int24(delta / int56(uint56(window)));

        // Always round towards negative infinity, matching Uniswap's OracleLibrary
        if (delta < 0 && (delta % int56(uint56(window)) != 0)) meanTick--;
    }

    /// @notice Value of `baseAmount` of base token, denominated in quote token, at `tick`
    /// @dev Reverts on overflow of the intermediate ratio; callers wrap in try-catch
    /// @param tick The tick at which to price
    /// @param baseAmount {qBaseTok} The amount of base token to quote
    /// @param baseToken The token being priced
    /// @param quoteToken The token the price is denominated in
    /// @return quoteAmount {qQuoteTok} The quote-token value of baseAmount of baseToken
    function getQuoteAtTick(
        int24 tick,
        uint128 baseAmount,
        address baseToken,
        address quoteToken
    ) internal pure returns (uint256 quoteAmount) {
        uint160 sqrtRatioX96 = TickMath.getSqrtRatioAtTick(tick);

        // Calculate quoteAmount with better precision if it doesn't overflow when multiplied by
        // itself
        if (sqrtRatioX96 <= type(uint128).max) {
            uint256 ratioX192 = uint256(sqrtRatioX96) * sqrtRatioX96;
            quoteAmount = baseToken < quoteToken
                ? mulDiv256(ratioX192, baseAmount, 1 << 192)
                : mulDiv256(1 << 192, baseAmount, ratioX192);
        } else {
            uint256 ratioX128 = mulDiv256(sqrtRatioX96, sqrtRatioX96, 1 << 64);
            quoteAmount = baseToken < quoteToken
                ? mulDiv256(ratioX128, baseAmount, 1 << 128)
                : mulDiv256(1 << 128, baseAmount, ratioX128);
        }
    }
}
