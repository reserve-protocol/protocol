// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "./CurveAppreciatingRTokenCollateral.sol";

/**
 * @title CurveAppreciatingRTokenSelfReferentialCollateral
 *  This plugin contract is intended for use with a CurveLP token for a pool between a
 *  self-referential reference token (WETH) and an RToken that is appreciating relative to it.
 *  Works for both CurveGaugeWrapper and ConvexStakingWrapper.
 *
 * tok = ConvexStakingWrapper(volatileCryptoPool)
 * ref = WETH
 * tar = ETH
 * UoA = USD
 *
 * @notice Curve pools with native ETH or ERC777 should be avoided,
 *  see docs/collateral.md for information
 */
contract CurveAppreciatingRTokenSelfReferentialCollateral is CurveAppreciatingRTokenCollateral {
    /// @dev config Unused members: chainlinkFeed, oracleError, oracleTimeout
    /// @dev config.erc20 should be a CurveGaugeWrapper or ConvexStakingWrapper
    constructor(
        CollateralConfig memory config,
        uint192 revenueHiding,
        PTConfiguration memory ptConfig
    ) CurveAppreciatingRTokenCollateral(config, revenueHiding, ptConfig) {
        require(config.defaultThreshold == 0, "defaultThreshold not zero");
    }

    // === Internal ===

    // Override this later to implement non-stable pools
    function _anyDepeggedInPool() internal view virtual override returns (bool) {
        // Ignore the status of the RToken since it can manage itself
        // Note that decreases in underlyingRefPerTok in excess of revenue hiding
        // still result in immediate default.

        return false;
    }
}
