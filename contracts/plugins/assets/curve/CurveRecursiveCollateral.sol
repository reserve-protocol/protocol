// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "../../../interfaces/IRToken.sol";
import "../../../libraries/Fixed.sol";
import "../curve/CurveStableCollateral.sol";
import "../OracleLib.sol";

/**
 * @title CurveRecursiveCollateral
 * @notice Collateral plugin for a CurveLP token for a pool between a
 *    a USD reference token and a USD RToken.
 *
 *    Note:
 *      - The RToken _must_ be the same RToken using this plugin as collateral!
 *      - The LP token should be worth ~2x the reference token. Do not use with 1x lpTokens.
 *
 * tok = ConvexStakingWrapper or CurveGaugeWrapper
 * ref = coins(0) in the pool
 * tar = USD
 * UoA = USD
 */
contract CurveRecursiveCollateral is CurveStableCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    IRToken internal immutable rToken; // token1

    /// @param config.erc20 must be of type ConvexStakingWrapper or CurveGaugeWrapper
    /// @param config.chainlinkFeed Feed units: {UoA/ref}
    constructor(
        CollateralConfig memory config,
        uint192 revenueHiding,
        PTConfiguration memory ptConfig
    ) CurveStableCollateral(config, revenueHiding, ptConfig) {
        rToken = IRToken(address(token1));
    }

    /// Can revert, used by other contract functions in order to catch errors
    /// Should not return FIX_MAX for low
    /// Should only return FIX_MAX for high if low is 0
    /// @return low {UoA/tok} The low price estimate
    /// @return high {UoA/tok} The high price estimate
    /// @return {target/ref} Unused. Always 0
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
        // This pricing method is MEV-resistant, but only gives a lower-bound
        // for the value of the LP token collateral. It could be that the pool is
        // very imbalanced, in which case the LP token could be worth more than this
        // method says it is if you can redeem the LP before any further swaps occur.

        // {UoA/tok} = {UoA/ref} * {ref/tok}
        uint192 price = chainlinkFeed.price(oracleTimeout).mul(underlyingRefPerTok());

        // {UoA/tok} = {UoA/tok} * {1}
        uint192 err = price.mul(oracleError, CEIL);

        // we'll overwrite these later...
        low = price - err;
        high = price + err;
        // assert(low <= high); // obviously true by inspection

        return (low, high, 0);
    }

    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function underlyingRefPerTok() public view virtual override returns (uint192) {
        // {ref/tok} = quantity of the reference unit token in the pool per vault token
        // the vault is 1:1 with the LP token

        if (lpToken.totalSupply() == 0) return FIX_ONE;

        // {lpToken@t=0/lpToken}
        uint192 virtualPrice = _safeWrap(curvePool.get_virtual_price());
        // this is missing the fact that USDC+ has also appreciated in this time

        // {BU/rTok}
        uint192 rTokenRate = divuu(rToken.basketsNeeded(), rToken.totalSupply());
        // div-by-zero impossible

        // {ref/tok} = {ref/lpToken} = {lpToken@t=0/lpToken} * {1} * 2{ref/lpToken@t=0}
        return virtualPrice.mul(rTokenRate.sqrt()).mulu(2); // LP token worth twice as much
    }

    // === Internal ===

    // Override this later to implement non-standard recursive pools
    function _anyDepeggedInPool() internal view virtual override returns (bool) {
        // Check reference token
        try this.tokenPrice(0) returns (uint192 low, uint192 high) {
            // {UoA/tok} = {UoA/tok} + {UoA/tok}
            uint192 mid = (low + high) / 2;

            // If the price is below the default-threshold price, default eventually
            // uint192(+/-) is the same as Fix.plus/minus
            if (mid < pegBottom || mid > pegTop) return true;
        } catch (bytes memory errData) {
            // see: docs/solidity-style.md#Catching-Empty-Data
            // untested:
            //      pattern validated in other plugins, cost to test is high
            if (errData.length == 0) revert(); // solhint-disable-line reason-string
            return true;
        }

        // Ignore the status of the RToken since it can manage itself

        return false;
    }
}
