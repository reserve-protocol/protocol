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
 * LP Token should be worth 2x the reference token at deployment
 *
 * tok = ConvexStakingWrapper(volatileCryptoPool)
 * ref = WETH
 * tar = ETH
 * UoA = USD
 *
 * @notice Curve pools with native ETH or ERC777 should be avoided,
 *  see docs/collateral.md for information
 */
contract CurveAppreciatingRTokenSelfReferentialCollateral is CurveAppreciatingRTokenFiatCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    // solhint-disable no-empty-blocks

    /// @dev config Unused members: chainlinkFeed, oracleError, oracleTimeout
    /// @dev config.erc20 should be a CurveGaugeWrapper or ConvexStakingWrapper
    constructor(
        CollateralConfig memory config,
        uint192 revenueHiding,
        PTConfiguration memory ptConfig
    ) CurveAppreciatingRTokenFiatCollateral(config, revenueHiding, ptConfig) {}

    // solhint-enable no-empty-blocks

    // === Internal ===

    function _anyDepeggedInPool() internal view virtual override returns (bool) {
        // Assumption: token0 is the RToken; token1 is the reference token

        // Check RToken price against reference token, accounting for appreciation
        try this.tokenPrice(0) returns (uint192 low0, uint192 high0) {
            // {UoA/tok} = {UoA/tok} + {UoA/tok}
            uint192 mid0 = (low0 + high0) / 2;

            // Remove the appreciation portion of the RToken price
            // {UoA/ref} = {UoA/tok} * {tok} / {ref}
            mid0 = mid0.muluDivu(rToken.totalSupply(), rToken.basketsNeeded());

            try this.tokenPrice(1) returns (uint192 low1, uint192 high1) {
                // {UoA/ref} = {UoA/ref} + {UoA/ref}
                uint192 mid1 = (low1 + high1) / 2;

                // {target/ref} = {UoA/ref} / {UoA/ref} * {target/ref}
                uint192 ratio = mid0.div(mid1); // * targetPerRef(), but we know it's 1

                // Check price of RToken relative to reference token
                if (ratio < pegBottom || ratio > pegTop) return true;
            } catch (bytes memory errData) {
                // see: docs/solidity-style.md#Catching-Empty-Data
                // untested:
                //      pattern validated in other plugins, cost to test is high
                if (errData.length == 0) revert(); // solhint-disable-line reason-string
                return true;
            }
        } catch (bytes memory errData) {
            // see: docs/solidity-style.md#Catching-Empty-Data
            // untested:
            //      pattern validated in other plugins, cost to test is high
            if (errData.length == 0) revert(); // solhint-disable-line reason-string
            return true;
        }

        return false;
    }
}
