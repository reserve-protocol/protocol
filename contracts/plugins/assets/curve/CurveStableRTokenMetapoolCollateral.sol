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

    IAssetRegistry internal immutable pairedAssetRegistry; // AssetRegistry of pairedToken

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
