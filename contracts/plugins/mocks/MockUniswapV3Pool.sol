// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.28;

/**
 * @title MockUniswapV3Pool
 * @notice Minimal Uniswap V3 pool stub with a settable arithmetic mean tick.
 *
 * `observe` synthesizes tickCumulatives such that, for any window,
 * (tickCumulatives[1] - tickCumulatives[0]) / window == meanTick exactly.
 * This lets tests drive the TWAP deterministically and exercise both token orderings.
 */
contract MockUniswapV3Pool {
    /// Arbitrary base offset for the synthesized cumulative series
    int56 private constant BASE = 1_000_000;

    address public token0;
    address public token1;

    int24 public meanTick;

    /// If true, observe() reverts "OLD", mimicking a window longer than retained observations
    bool public revertOld;

    constructor(
        address token0_,
        address token1_,
        int24 meanTick_
    ) {
        token0 = token0_;
        token1 = token1_;
        meanTick = meanTick_;
    }

    function setMeanTick(int24 meanTick_) external {
        meanTick = meanTick_;
    }

    function setRevertOld(bool revertOld_) external {
        revertOld = revertOld_;
    }

    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (
            int56[] memory tickCumulatives,
            uint160[] memory secondsPerLiquidityCumulativeX128s
        )
    {
        require(!revertOld, "OLD");

        tickCumulatives = new int56[](secondsAgos.length);
        secondsPerLiquidityCumulativeX128s = new uint160[](secondsAgos.length);

        for (uint256 i = 0; i < secondsAgos.length; ++i) {
            // tickCumulative(t) = meanTick * t, sampled at t = BASE - secondsAgo
            tickCumulatives[i] =
                int56(meanTick) *
                (BASE - int56(uint56(secondsAgos[i])));
        }
    }
}
