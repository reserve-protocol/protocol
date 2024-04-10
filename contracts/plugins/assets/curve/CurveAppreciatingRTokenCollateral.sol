// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "./CurveStableCollateral.sol";

/**
 * @title CurveAppreciatingRTokenCollateral
 *  This plugin contract is intended for use with a CurveLP token for a pool between a
 *  fiat reference token and an RToken that is appreciating relative to it.
 *  Works for both CurveGaugeWrapper and ConvexStakingWrapper.
 *
 * Warning: Defaults after haircut! After the RToken devalues the collateral plugin
 *          will default and the collateral will be removed from the basket.
 *
 * tok = ConvexStakingWrapper(volatileCryptoPool)
 * ref = USDC
 * tar = USD
 * UoA = USD
 *
 * @notice Curve pools with native ETH or ERC777 should be avoided,
 *  see docs/collateral.md for information
 */
contract CurveAppreciatingRTokenCollateral is CurveStableCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    IAssetRegistry internal immutable assetRegistry;
    IRToken internal immutable rToken; // token0

    /// @dev config Unused members: chainlinkFeed, oracleError, oracleTimeout
    /// @dev config.erc20 should be a CurveGaugeWrapper or ConvexStakingWrapper
    constructor(
        CollateralConfig memory config,
        uint192 revenueHiding,
        PTConfiguration memory ptConfig
    ) CurveStableCollateral(config, revenueHiding, ptConfig) {
        rToken = IRToken(address(token0));
        assetRegistry = rToken.main().assetRegistry();
    }

    function refresh() public override {
        assetRegistry.refresh(); // refresh all registered assets in the RToken
        super.refresh(); // already handles all necessary default checks
    }

    /// @dev Not up-only! The RToken can devalue its exchange rate peg
    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function underlyingRefPerTok() public view virtual override returns (uint192) {
        // {ref/tok} = quantity of the reference unit token in the pool per vault token
        // the vault is 1:1 with the LP token

        // {lpToken@t=0/lpToken}
        uint192 virtualPrice = _safeWrap(curvePool.get_virtual_price());
        // this is missing the fact that USDC+ has also appreciated in this time

        // {BU/rTok}
        uint192 rTokenRate = divuu(rToken.basketsNeeded(), rToken.totalSupply());
        // not worth the gas to protect against div-by-zero

        // The rTokenRate is not up-only! We should expect decreases when other
        // collateral default and there is not enough RSR stake to cover the hole.

        // {ref/tok} = {ref/lpToken} = {lpToken@t=0/lpToken} * {1} * 2{ref/lpToken@t=0}
        return virtualPrice.mul(rTokenRate.sqrt()).mulu(2); // LP token worth twice as much
    }

    /// @dev Warning: Can revert
    /// @param index The index of the token: 0, 1, 2, or 3
    /// @return low {UoA/ref_index}
    /// @return high {UoA/ref_index}
    function tokenPrice(uint8 index) public view override returns (uint192 low, uint192 high) {
        if (index == 0) {
            (low, high) = assetRegistry.toAsset(IERC20(address(rToken))).price();
            require(low != 0 && high != FIX_MAX, "rToken unpriced");
        } else {
            return super.tokenPrice(index);
        }
    }

    // === Internal ===

    function _anyDepeggedInPool() internal view virtual override returns (bool) {
        // Assumption: token0 is the RToken; token1 is the reference token

        // TODO currently this isn't used, but when it is, check that the logic makes
        // sense and also that it's worth spending this much gas. two computations
        // of the RToken's price in refresh() is a lot

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

                // If the price is below the default-threshold price, default eventually
                // uint192(+/-) is the same as Fix.plus/minus
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
