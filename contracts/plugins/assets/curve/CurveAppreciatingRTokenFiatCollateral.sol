// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "./CurveStableCollateral.sol";

/**
 * @title CurveAppreciatingRTokenFiatCollateral
 *  This plugin contract is intended for use with a CurveLP token for a pool between a
 *  USD reference token and an RToken that is appreciating relative to it.
 *  Works for both CurveGaugeWrapper and ConvexStakingWrapper.
 *
 * Warning: Defaults after haircut! After the RToken accepts a devaluation this collateral
 *          plugin will default and the collateral will be removed from the basket.
 *
 * LP Token should be worth 2x the reference token at deployment
 *
 * tok = ConvexStakingWrapper(volatileCryptoPool)
 * ref = USDC
 * tar = USD
 * UoA = USD
 *
 * @notice Curve pools with native ETH or ERC777 should be avoided,
 *  see docs/collateral.md for information
 */
contract CurveAppreciatingRTokenFiatCollateral is CurveStableCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    IRToken internal immutable rToken; // token0, but typed
    IAssetRegistry internal immutable pairedAssetRegistry; // AssetRegistry of paired RToken
    IBasketHandler internal immutable pairedBasketHandler; // BasketHandler of paired RToken

    /// @dev config Unused members: chainlinkFeed, oracleError, oracleTimeout
    /// @dev config.erc20 should be a CurveGaugeWrapper or ConvexStakingWrapper
    constructor(
        CollateralConfig memory config,
        uint192 revenueHiding,
        PTConfiguration memory ptConfig
    ) CurveStableCollateral(config, revenueHiding, ptConfig) {
        rToken = IRToken(address(token0));
        IMain main = rToken.main();
        pairedAssetRegistry = main.assetRegistry();
        pairedBasketHandler = main.basketHandler();
    }

    /// Should not revert
    /// Refresh exchange rates and update default status.
    /// Have to override to add custom default checks
    function refresh() public virtual override {
        // solhint-disable-next-line no-empty-blocks
        try pairedAssetRegistry.refresh() {} catch {
            // must allow failure since cannot brick refresh()
        }

        CollateralStatus oldStatus = status();

        // Check for hard default
        // must happen before tryPrice() call since `refPerTok()` returns a stored value

        // revenue hiding: do not DISABLE if drawdown is small
        try this.underlyingRefPerTok() returns (uint192 underlyingRefPerTok_) {
            // {ref/tok} = {ref/tok} * {1}
            uint192 hiddenReferencePrice = underlyingRefPerTok_.mul(revenueShowing);

            // uint192(<) is equivalent to Fix.lt
            if (underlyingRefPerTok_ < exposedReferencePrice) {
                exposedReferencePrice = underlyingRefPerTok_;
                markStatus(CollateralStatus.DISABLED);
            } else if (hiddenReferencePrice > exposedReferencePrice) {
                exposedReferencePrice = hiddenReferencePrice;
            }

            // Check for soft default + save prices
            try this.tryPrice() returns (uint192 low, uint192 high, uint192 pegPrice) {
                // {UoA/tok}, {UoA/tok}, {UoA/tok}
                // (0, 0) is a valid price; (0, FIX_MAX) is unpriced

                // Save prices if priced
                if (high != FIX_MAX) {
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

                // Check pool status: inner RToken must be both isReady() and
                // fullyCollateralized() to prevent injection of bad debt.
                try pairedBasketHandler.isReady() returns (bool isReady) {
                    if (
                        !isReady ||
                        low == 0 ||
                        _anyDepeggedInPool() ||
                        _anyDepeggedOutsidePool() ||
                        !pairedBasketHandler.fullyCollateralized()
                    ) {
                        // If the price is below the default-threshold price, default eventually
                        // uint192(+/-) is the same as Fix.plus/minus
                        markStatus(CollateralStatus.IFFY);
                    } else {
                        markStatus(CollateralStatus.SOUND);
                    }
                } catch {
                    // prefer NOT to revert on empty data here: an RToken missing the `isReady()`
                    // function would error out with empty data just like an OOG error.
                    markStatus(CollateralStatus.IFFY);
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
    /// @dev Assumption: The RToken BU is intended to equal the reference token in value
    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function underlyingRefPerTok() public view virtual override returns (uint192) {
        // {ref/tok} = quantity of the reference unit token in the pool per LP token

        // {lpToken@t=0/lpToken}
        uint192 virtualPrice = _safeWrap(curvePool.get_virtual_price());
        // this is missing the fact that the RToken has also appreciated in this time

        // {BU/rTok}
        uint192 rTokenRate = divuu(rToken.basketsNeeded(), rToken.totalSupply());
        // not worth the gas to protect against div-by-zero

        // {ref/tok} = {ref/lpToken} = {lpToken@t=0/lpToken} * {1} * 2{ref/lpToken@t=0}
        return virtualPrice.mul(rTokenRate.sqrt()).mulu(2); // LP token worth twice as much
    }

    /// @dev Warning: Can revert
    /// @dev Only works when the RToken is the 0th index token
    /// @param index The index of the token: 0, 1, 2, or 3
    /// @return low {UoA/ref_index}
    /// @return high {UoA/ref_index}
    function tokenPrice(uint8 index) public view override returns (uint192 low, uint192 high) {
        if (index == 0) {
            (low, high) = pairedAssetRegistry.toAsset(IERC20(address(rToken))).price();
            require(low != 0 && high != FIX_MAX, "rToken unpriced");
        } else {
            return super.tokenPrice(index);
        }
    }

    // === Internal ===

    function _anyDepeggedInPool() internal view virtual override returns (bool) {
        // Assumption: token0 is the RToken; token1 is the reference token

        // Check reference token price
        try this.tokenPrice(1) returns (uint192 low1, uint192 high1) {
            // {target/ref} = {UoA/ref} = {UoA/ref} + {UoA/ref}
            uint192 mid1 = (low1 + high1) / 2;

            // Check price of reference token
            if (mid1 < pegBottom || mid1 > pegTop) return true;
        } catch (bytes memory errData) {
            // see: docs/solidity-style.md#Catching-Empty-Data
            // untested:
            //      pattern validated in other plugins, cost to test is high
            if (errData.length == 0) revert(); // solhint-disable-line reason-string
            return true;
        }

        // The RToken does not need to be monitored given more restrictive hard-default checks

        return false;
    }
}
