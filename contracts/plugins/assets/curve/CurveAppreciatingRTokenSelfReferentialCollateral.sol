// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "./CurveAppreciatingRTokenFiatCollateral.sol";

/**
 * @title CurveAppreciatingRTokenSelfReferentialCollateral
 *  This plugin contract is intended for use with a CurveLP token for a pool between a
 *  self-referential reference token (WETH) and an RToken that is appreciating relative to it.
 *  Works for both CurveGaugeWrapper and ConvexStakingWrapper.
 *
 * Warning: Defaults after haircut! After the RToken accepts a devaluation this collateral
 *          plugin will default and the collateral will be removed from the basket.
 *
 * LP Token should be worth 1x the reference token at deployment, not 2x like many CryptoSwaps.
 *
 * tok = ConvexStakingWrapper(stableSwapNGPool)
 * ref = WETH
 * tar = ETH
 * UoA = USD
 * 
 * Important: Make sure the Curve pool is compatible with the plugin! This includes pool 
 *   invariants AND security assumptions like reentrancy vectors. Compare to existing deployments!
 */
contract CurveAppreciatingRTokenSelfReferentialCollateral is CurveAppreciatingRTokenFiatCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    // solhint-disable no-empty-blocks

    /// @dev config Unused members: chainlinkFeed, oracleError, oracleTimeout
    /// @dev config.erc20 should be a CurveGaugeWrapper or ConvexStakingWrapper
    /// @param pairedRTokenRefreshInterval_ {s} Refresh interval of the inner RToken
    constructor(
        CollateralConfig memory config,
        uint192 revenueHiding,
        PTConfiguration memory ptConfig,
        uint256 pairedRTokenRefreshInterval_
    )
        CurveAppreciatingRTokenFiatCollateral(
            config,
            revenueHiding,
            ptConfig,
            pairedRTokenRefreshInterval_
        )
    {}

    // === Internal ===

    function _anyDepeggedInPool() internal view virtual override returns (bool) {
        // WETH cannot de-peg against ETH (the price feed we have is ETH/USD)
        // The RToken does not need to be monitored given more restrictive hard-default checks
        return false;
    }
}
