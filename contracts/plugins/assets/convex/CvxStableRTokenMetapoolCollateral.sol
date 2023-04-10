// SPDX-License-Identifier: ISC
pragma solidity 0.8.17;

import "./CvxStableMetapoolCollateral.sol";

/**
 * @title CvxStableRTokenMetapoolCollateral
 *  This plugin contract is intended for 2-token stable metapools that
 *  involve RTokens, such as eUSD-fraxBP.
 *
 * tok = ConvexStakingWrapper(cvxPairedUSDRToken/USDBasePool)
 * ref = PairedUSDRToken/USDBasePool pool invariant
 * tar = USD
 * UoA = USD
 */
contract CvxStableRTokenMetapoolCollateral is CvxStableMetapoolCollateral {
    using FixLib for uint192;

    IAssetRegistry internal immutable pairedAssetRegistry; // AssetRegistry of pairedToken

    /// @param config.chainlinkFeed Feed units: {UoA/pairedTok}
    /// @dev config.chainlinkFeed/oracleError/oracleTimeout are unused; set chainlinkFeed to 0x1
    /// @dev config.erc20 should be a IConvexStakingWrapper
    constructor(
        CollateralConfig memory config,
        uint192 revenueHiding,
        PTConfiguration memory ptConfig,
        ICurveMetaPool metapoolToken_,
        uint192 pairedTokenDefaultThreshold_
    )
        CvxStableMetapoolCollateral(
            config,
            revenueHiding,
            ptConfig,
            metapoolToken_,
            pairedTokenDefaultThreshold_
        )
    {
        pairedAssetRegistry = IRToken(address(pairedToken)).main().assetRegistry();
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
