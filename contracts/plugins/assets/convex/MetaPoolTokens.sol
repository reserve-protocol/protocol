// SPDX-License-Identifier: ISC
pragma solidity 0.8.17;

import "./PoolTokens.sol";

// solhint-disable-next-line no-empty-blocks
interface ICurveMetaPool is ICurvePool, IERC20Metadata {

}

/// Supports CvxCurve 2.0 Metapools
contract MetaPoolTokens is PoolTokens {
    using FixLib for uint192;

    ICurveMetaPool internal immutable metapool; // top-level LP token + CurvePool

    IERC20Metadata internal immutable pairedToken; // the token paired with ptConfig.lpToken

    constructor(PTConfiguration memory config, ICurveMetaPool metapool_) PoolTokens(config) {
        require(address(metapool_) != address(0), "metapool address is zero");
        metapool = metapool_;
        pairedToken = IERC20Metadata(metapool.coins(0)); // like eUSD or alUSD

        // Sanity checks
        assert(address(pairedToken) != address(0));
        assert(metapool.coins(1) == address(lpToken));
        assert(metapool.coins(2) == address(0)); // only 2 tokens
    }

    // === Internal ===

    /// @param lowPaired {UoA/pairedTok}
    /// @param highPaired {UoA/pairedTok}
    /// @return low {UoA}
    /// @return high {UoA}
    function totalBalancesValue(uint192 lowPaired, uint192 highPaired)
        internal
        view
        returns (uint192 low, uint192 high)
    {
        // {UoA}
        (uint192 underlyingAumLow, uint192 underlyingAumHigh) = super.totalBalancesValue();

        // {tokUnderlying}
        uint192 underlyingSupply = shiftl_toFix(lpToken.totalSupply(), -int8(lpToken.decimals()));

        // {UoA/tokUnderlying} = {UoA} / {tokUnderlying}
        uint192 underlyingLow = underlyingAumLow.div(underlyingSupply, FLOOR);
        uint192 underlyingHigh = underlyingAumHigh.div(underlyingSupply, CEIL);

        // {tokUnderlying}
        uint192 balUnderlying = shiftl_toFix(metapool.balances(1), -int8(lpToken.decimals()));

        // {UoA} = {UoA/tokUnderlying} * {tokUnderlying}
        low = underlyingLow.mul(balUnderlying, FLOOR);
        high = underlyingHigh.mul(balUnderlying, CEIL);

        // {pairedTok}
        uint192 pairedBal = shiftl_toFix(metapool.balances(0), -int8(pairedToken.decimals()));

        // Add-in contribution from pairedTok
        // {UoA} = {UoA} + {UoA/pairedTok} * {pairedTok}
        low += lowPaired.mul(pairedBal, FLOOR);
        high += highPaired.mul(pairedBal, CEIL);
    }
}
