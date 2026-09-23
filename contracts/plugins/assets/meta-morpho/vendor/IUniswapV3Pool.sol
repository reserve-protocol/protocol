// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.28;

/// Minimal subset of the Uniswap V3 pool interface needed for TWAP consultation
interface IUniswapV3Pool {
    /// @notice Returns the cumulative tick and liquidity as of each timestamp `secondsAgos`
    /// @dev Reverts with "OLD" if the oldest stored observation is more recent than the largest
    ///      requested `secondsAgo`. The number of observations retained is governed by the pool's
    ///      observationCardinality, which can be grown permissionlessly by anyone via
    ///      increaseObservationCardinalityNext().
    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (
            int56[] memory tickCumulatives,
            uint160[] memory secondsPerLiquidityCumulativeX128s
        );

    function token0() external view returns (address);

    function token1() external view returns (address);

    /// @dev Uniswap V3 exposes no standalone getter for observationCardinality; it is packed
    ///      into slot0. Not used by this plugin at runtime -- only by the deployment script's
    ///      pre-flight check on the pool's observation buffer.
    function slot0()
        external
        view
        returns (
            uint160 sqrtPriceX96,
            int24 tick,
            uint16 observationIndex,
            uint16 observationCardinality,
            uint16 observationCardinalityNext,
            uint8 feeProtocol,
            bool unlocked
        );
}
