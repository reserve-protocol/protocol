// SPDX-License-Identifier: ISC
pragma solidity 0.8.17;

import "./CvxStableCollateral.sol";

// solhint-disable no-empty-blocks
interface ICurveMetaPool is ICurvePool, IERC20Metadata {

}

/**
 * @title CvxStableMetapoolCollateral
 *  This plugin contract is intended for 2-token stable metapools that
 *  DO NOT involve RTokens, such as alUSD-fraxBP or MIM-3CRV.
 *
 * tok = ConvexStakingWrapper(PairedUSDToken/USDBasePool)
 * ref = PairedUSDToken/USDBasePool pool invariant
 * tar = USD
 * UoA = USD
 */
contract CvxStableMetapoolCollateral is CvxStableCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    ICurveMetaPool internal immutable metapool; // top-level LP token + CurvePool

    IERC20Metadata internal immutable pairedToken; // the token paired with ptConfig.lpToken

    /// @dev config.chainlinkFeed/oracleError/oracleTimeout should be set for paired token
    /// @dev config.erc20 should be a IConvexStakingWrapper
    constructor(
        CollateralConfig memory config,
        uint192 revenueHiding,
        PTConfiguration memory ptConfig,
        ICurveMetaPool metapool_
    ) CvxStableCollateral(config, revenueHiding, ptConfig) {
        require(address(metapool_) != address(0), "metapool address is zero");
        metapool = metapool_;
        pairedToken = IERC20Metadata(metapool.coins(0)); // like alUSD or MIM

        // Sanity checks we have the correct pool
        assert(address(pairedToken) != address(0));
        assert(metapool.coins(1) == address(lpToken));
    }

    /// Can revert, used by other contract functions in order to catch errors
    /// Should not return FIX_MAX for low
    /// Should only return FIX_MAX for high if low is 0
    /// @dev Override this when pricing is more complicated than just a single oracle
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
        // Should include revenue hiding discount in the low discount but not high

        // {UoA/pairedTok}
        (uint192 lowPaired, uint192 highPaired) = tryPairedPrice();

        // {UoA}
        (uint192 aumLow, uint192 aumHigh) = metapoolBalancesValue(lowPaired, highPaired);

        // discount aumLow by the amount of revenue being hidden
        // {UoA} = {UoA} * {1}
        aumLow = aumLow.mul(revenueShowing);

        // {tok}
        uint192 supply = shiftl_toFix(metapool.totalSupply(), -int8(metapool.decimals()));
        // We can always assume that the total supply is non-zero

        // {UoA/tok} = {UoA} / {tok}
        low = aumLow.div(supply);
        high = aumHigh.div(supply);
        return (low, high, 0);
    }

    /// Can revert, used by `_anyDepeggedOutsidePool()`
    /// Should not return FIX_MAX for low
    /// Should only return FIX_MAX for high if low is 0
    /// @return low {UoA/pairedTok} The low price estimate
    /// @return high {UoA/pairedTok} The high price estimate
    function tryPairedPrice() public view virtual returns (uint192 low, uint192 high) {
        uint192 p = chainlinkFeed.price(oracleTimeout); // {UoA/pairedTok}
        uint192 delta = p.mul(oracleError);
        return (p - delta, p + delta);
    }

    // === Internal ===

    /// @return {ref/tok} Actual quantity of whole reference units per whole collateral tokens
    function _underlyingRefPerTok() internal view override returns (uint192) {
        return _safeWrap(metapool.get_virtual_price());
    }

    // Check for defaults outside the pool
    function _anyDepeggedOutsidePool() internal view virtual override returns (bool) {
        try this.tryPairedPrice() returns (uint192 low, uint192 high) {
            // {UoA/tok} = {UoA/tok} + {UoA/tok}
            uint192 mid = (low + high) / 2;

            // If the price is below the default-threshold price, default eventually
            // uint192(+/-) is the same as Fix.plus/minus
            if (mid < pegBottom || mid > pegTop) return true;
        } catch (bytes memory errData) {
            // see: docs/solidity-style.md#Catching-Empty-Data
            if (errData.length == 0) revert(); // solhint-disable-line reason-string
            return true;
        }
        return false;
    }

    /// @param lowPaired {UoA/pairedTok}
    /// @param highPaired {UoA/pairedTok}
    /// @return aumLow {UoA}
    /// @return aumHigh {UoA}
    function metapoolBalancesValue(uint192 lowPaired, uint192 highPaired)
        internal
        view
        returns (uint192 aumLow, uint192 aumHigh)
    {
        // {UoA}
        (uint192 underlyingAumLow, uint192 underlyingAumHigh) = totalBalancesValue();

        // {tokUnderlying}
        uint192 underlyingSupply = shiftl_toFix(lpToken.totalSupply(), -int8(lpToken.decimals()));

        // {UoA/tokUnderlying} = {UoA} / {tokUnderlying}
        uint192 underlyingLow = underlyingAumLow.div(underlyingSupply, FLOOR);
        uint192 underlyingHigh = underlyingAumHigh.div(underlyingSupply, CEIL);

        // {tokUnderlying}
        uint192 balUnderlying = shiftl_toFix(metapool.balances(1), -int8(lpToken.decimals()));

        // {UoA} = {UoA/tokUnderlying} * {tokUnderlying}
        aumLow = underlyingLow.mul(balUnderlying, FLOOR);
        aumHigh = underlyingHigh.mul(balUnderlying, CEIL);

        // {pairedTok}
        uint192 pairedBal = shiftl_toFix(metapool.balances(0), -int8(pairedToken.decimals()));

        // Add-in contribution from pairedTok
        // {UoA} = {UoA} + {UoA/pairedTok} * {pairedTok}
        aumLow += lowPaired.mul(pairedBal, FLOOR);
        aumHigh += highPaired.mul(pairedBal, CEIL);
    }
}
