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
 *      - The RToken SHOULD have an RSR overcollateralization layer. DO NOT USE WITHOUT RSR!
 *      - The LP token should be worth ~2x the reference token. Do not use with 1x lpTokens.
 *      - Lastly: Do NOT deploy an RToken with this collateral! It can only be swapped
 *                in at a later date once the RToken has nonzero issuance.
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

    // does not become nonzero until after first refresh()
    uint192 internal poolVirtualPrice; // {lpToken@t=0/lpToken} max virtual price sub revenue hiding

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
    /// Should NOT be manipulable by MEV
    /// @return low {UoA/tok} The low price estimate
    /// @return high {UoA/tok} The high price estimate
    /// @return pegPrice {target/ref} The actual price observed in the peg
    function tryPrice()
        external
        view
        virtual
        override
        returns (
            uint192 low,
            uint192 high,
            uint192 pegPrice
        )
    {
        // This pricing method is MEV-resistant, but only gives a lower-bound
        // for the value of the LP token collateral. It could be that the pool is
        // very imbalanced, in which case the LP token could be worth more than this
        // method says it is.

        // Get reference token price
        (uint192 refLow, uint192 refHigh) = this.tokenPrice(0); // reference token
        pegPrice = refLow.plus(refHigh).divu(2, FLOOR);

        // Multiply by the underlyingRefPerTok()
        uint192 rate = underlyingRefPerTok();
        low = refLow.mul(rate, FLOOR);
        high = refHigh.mul(rate, CEIL);

        assert(low <= high); // not obviously true by inspection
    }

    /// Should not revert
    /// Refresh exchange rates and update default status.
    /// Have to override to add custom default checks
    function refresh() public virtual override {
        CollateralStatus oldStatus = status();

        try this.underlyingRefPerTok() returns (uint192 underlyingRefPerTok_) {
            // Instead of ensuring the underlyingRefPerTok is up-only, solely check
            // that the pool's virtual price is up-only. Otherwise this collateral
            // would create default cascades when basketsNeeded()/totalSupply() falls.

            // === Check for virtualPrice hard default ===

            // {lpToken@t=0/lpToken}
            uint192 virtualPrice = _safeWrap(curvePool.get_virtual_price());

            // {lpToken@t=0/lpToken}
            uint192 hiddenVirtualPrice = virtualPrice.mul(revenueShowing);

            // uint192(<) is equivalent to Fix.lt
            if (virtualPrice < poolVirtualPrice) {
                poolVirtualPrice = virtualPrice;
                markStatus(CollateralStatus.DISABLED);
            } else if (hiddenVirtualPrice > poolVirtualPrice) {
                poolVirtualPrice = hiddenVirtualPrice;
            }

            // === Update exposedReferencePrice, ignoring default ===

            // {ref/tok} = {ref/tok} * {1}
            uint192 hiddenReferencePrice = underlyingRefPerTok_.mul(revenueShowing);

            // uint192(<) is equivalent to Fix.lt
            if (underlyingRefPerTok_ < exposedReferencePrice) {
                exposedReferencePrice = underlyingRefPerTok_;
                // markStatus(CollateralStatus.DISABLED); // don't DISABLE
            } else if (hiddenReferencePrice > exposedReferencePrice) {
                exposedReferencePrice = hiddenReferencePrice;
            }

            // === Check for soft default ===

            // Check for soft default + save prices
            try this.tryPrice() returns (uint192 low, uint192 high, uint192 pegPrice) {
                // {UoA/tok}, {UoA/tok}, {UoA/tok}
                // (0, 0) is a valid price; (0, FIX_MAX) is unpriced

                // Save prices if priced
                if (high < FIX_MAX) {
                    savedLowPrice = low;
                    savedHighPrice = high;
                    savedPegPrice = pegPrice;
                    lastSave = uint48(block.timestamp);
                } else {
                    // must be unpriced
                    // untested:
                    //      validated in other plugins, cost to test here is high
                    assert(low == 0);
                }

                // If the price is below the default-threshold price, default eventually
                // uint192(+/-) is the same as Fix.plus/minus
                if (low == 0 || _anyDepeggedInPool() || _anyDepeggedOutsidePool()) {
                    markStatus(CollateralStatus.IFFY);
                } else {
                    markStatus(CollateralStatus.SOUND);
                }
            } catch (bytes memory errData) {
                // see: docs/solidity-style.md#Catching-Empty-Data
                if (errData.length == 0) revert(); // solhint-disable-line reason-string
                markStatus(CollateralStatus.IFFY);
            }
        } catch (bytes memory errData) {
            // see: docs/solidity-style.md#Catching-Empty-Data
            if (errData.length == 0) revert(); // solhint-disable-line reason-string
            markStatus(CollateralStatus.DISABLED);
        }

        CollateralStatus newStatus = status();
        if (oldStatus != newStatus) {
            emit CollateralStatusChanged(oldStatus, newStatus);
        }
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

    // === Internal ===

    // Override this later to implement non-standard recursive pools
    function _anyDepeggedInPool() internal view virtual override returns (bool) {
        // Assumption: token0 is the reference token; token1 is the RToken

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

        // Ignore the status of the RToken to prevent circularity

        return false;
    }
}
