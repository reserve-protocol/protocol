// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "./CurveStableMetapoolCollateral.sol";

/**
 * @title CurveStableRTokenMetapoolCollateral
 *  This plugin contract is intended for 2-fiattoken stable metapools that
 *  involve RTokens, such as eUSD-fraxBP.
 *
 * tok = ConvexStakingWrapper(pairedUSDRToken/USDBasePool)
 * ref = PairedUSDRToken/USDBasePool pool invariant
 * tar = USD
 * UoA = USD
 *
 * @notice Curve pools with native ETH or ERC777 should be avoided,
 *  see docs/collateral.md for information
 */
contract CurveStableRTokenMetapoolCollateral is CurveStableMetapoolCollateral {
    using FixLib for uint192;

    IAssetRegistry internal immutable pairedAssetRegistry; // AssetRegistry of paired RToken
    IBasketHandler internal immutable pairedBasketHandler; // BasketHandler of paired RToken

    /// @param config.chainlinkFeed Feed units: {UoA/pairedTok}
    /// @dev config.chainlinkFeed/oracleError/oracleTimeout are unused; set chainlinkFeed to 0x1
    /// @dev config.erc20 should be a RewardableERC20
    constructor(
        CollateralConfig memory config,
        uint192 revenueHiding,
        PTConfiguration memory ptConfig,
        ICurveMetaPool metapoolToken_,
        uint192 pairedTokenDefaultThreshold_
    )
        CurveStableMetapoolCollateral(
            config,
            revenueHiding,
            ptConfig,
            metapoolToken_,
            pairedTokenDefaultThreshold_
        )
    {
        IMain main = IRToken(address(pairedToken)).main();
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

    /// Can revert, used by `_anyDepeggedOutsidePool()`
    /// Should not return FIX_MAX for low
    /// @return lowPaired {UoA/pairedTok} The low price estimate of the paired token
    /// @return highPaired {UoA/pairedTok} The high price estimate of the paired token
    function tryPairedPrice()
        public
        view
        virtual
        override
        returns (uint192 lowPaired, uint192 highPaired)
    {
        return pairedAssetRegistry.toAsset(pairedToken).price();
    }
}
