// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "./CurveStableCollateral.sol";

// solhint-disable no-empty-blocks
interface ICurveMetaPool is ICurvePool, IERC20Metadata {

}

/**
 * @title CurveStableMetapoolCollateral
 *  This plugin contract is intended for 2-fiattoken stable metapools that
 *  DO NOT involve RTokens, such as LUSD-fraxBP or MIM-3CRV.
 *
 *  Does not support older metapools that have a separate contract for the
 *  metapool's LP token.
 *
 * tok = ConvexStakingWrapper(PairedUSDToken/USDBasePool)
 * ref = PairedUSDToken/USDBasePool pool invariant
 * tar = USD
 * UoA = USD
 *
 * @notice Curve pools with native ETH or ERC777 should be avoided,
 *  see docs/collateral.md for information
 */
contract CurveStableMetapoolCollateral is CurveStableCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    ICurveMetaPool public immutable metapoolToken; // top-level LP token + CurvePool

    IERC20Metadata public immutable pairedToken; // the token paired with ptConfig.lpToken

    uint192 public immutable pairedTokenPegBottom; // {target/ref} pegBottom but for paired token

    uint192 public immutable pairedTokenPegTop; // {target/ref} pegTop but for paired token

    /// @param config.chainlinkFeed Feed units: {UoA/pairedTok}
    /// @dev config.chainlinkFeed/oracleError/oracleTimeout should be set for paired token
    /// @dev config.erc20 should be a RewardableERC20
    constructor(
        CollateralConfig memory config,
        uint192 revenueHiding,
        PTConfiguration memory ptConfig,
        ICurveMetaPool metapoolToken_,
        uint192 pairedTokenDefaultThreshold_
    ) CurveStableCollateral(config, revenueHiding, ptConfig) {
        require(address(metapoolToken_) != address(0), "metapoolToken address is zero");
        require(
            pairedTokenDefaultThreshold_ > 0 && pairedTokenDefaultThreshold_ < FIX_ONE,
            "pairedTokenDefaultThreshold out of bounds"
        );
        metapoolToken = metapoolToken_;
        pairedToken = IERC20Metadata(metapoolToken.coins(0)); // like LUSD or MIM

        // {target/ref} = {target/ref} * {1}
        uint192 peg = targetPerRef(); // {target/ref}
        uint192 delta = peg.mul(pairedTokenDefaultThreshold_);
        pairedTokenPegBottom = peg - delta;
        pairedTokenPegTop = peg + delta;

        // Sanity checks we have the correct pool
        assert(address(pairedToken) != address(0));
        assert(metapoolToken.coins(1) == address(lpToken));
    }

    /// Can revert, used by other contract functions in order to catch errors
    /// Should not return FIX_MAX for low
    /// Should only return FIX_MAX for high if low is 0
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
        // Assumption: the pool is balanced
        //
        // This pricing method returns a MINIMUM when the pool is balanced.
        // It IS possible to interact with the protocol within a sandwich to manipulate
        // LP token price upwards.
        //
        // However:
        //    - Lots of manipulation is required;
        //        (StableSwap pools are not price sensitive until the edge of the curve)
        //    - The DutchTrade pricing curve accounts for small/medium amounts of manipulation
        //    - The manipulator is under competition in auctions, so cannot guarantee they
        //        are the beneficiary of the manipulation.
        //
        // To be more MEV-resistant requires not using spot balances at all, which means one-of:
        //   1. A moving average metric (unavailable in the cases we care about)
        //   2. Mapping oracle prices to expected pool balances using precise knowledge about
        //      the shape of the trading curve. (maybe we can do this in the future)

        // {UoA/pairedTok}
        (uint192 lowPaired, uint192 highPaired) = tryPairedPrice();
        require(lowPaired != 0 && highPaired != FIX_MAX, "invalid price");

        // {UoA}
        (uint192 aumLow, uint192 aumHigh) = _metapoolBalancesValue(lowPaired, highPaired);

        // {tok}
        uint192 supply = shiftl_toFix(metapoolToken.totalSupply(), -int8(metapoolToken.decimals()));
        // We can always assume that the total supply is non-zero

        // {UoA/tok} = {UoA} / {tok}
        low = aumLow.div(supply, FLOOR);
        high = aumHigh.div(supply, CEIL);
        assert(low <= high); // not obviously true just by inspection

        return (low, high, 0);
    }

    /// Can revert, used by `_anyDepeggedOutsidePool()`
    /// Should not return FIX_MAX for low
    /// Should only return FIX_MAX for high if low is 0
    /// @return lowPaired {UoA/pairedTok} The low price estimate of the paired token
    /// @return highPaired {UoA/pairedTok} The high price estimate of the paired token
    function tryPairedPrice() public view virtual returns (uint192 lowPaired, uint192 highPaired) {
        uint192 p = chainlinkFeed.price(oracleTimeout); // {UoA/pairedTok}
        uint192 delta = p.mul(oracleError, CEIL);
        return (p - delta, p + delta);
    }

    // === Internal ===

    /// @return {ref/tok} Actual quantity of whole reference units per whole collateral tokens
    function underlyingRefPerTok() public view override returns (uint192) {
        return _safeWrap(metapoolToken.get_virtual_price()); // includes inner virtual price
    }

    // Check for defaults outside the pool
    function _anyDepeggedOutsidePool() internal view virtual override returns (bool) {
        try this.tryPairedPrice() returns (uint192 low, uint192 high) {
            // D18{UoA/tok} = D18{UoA/tok} + D18{UoA/tok}
            uint256 mid = (low + uint256(high)) / 2;

            // If the price is below the default-threshold price, default eventually
            // uint192(+/-) is the same as Fix.plus/minus
            if (mid < pairedTokenPegBottom || mid > pairedTokenPegTop) return true;
        } catch (bytes memory errData) {
            // see: docs/solidity-style.md#Catching-Empty-Data
            // untested:
            //      pattern validated in other plugins, cost to test is high
            if (errData.length == 0) revert(); // solhint-disable-line reason-string
            return true;
        }
        return false;
    }

    /// Return the UoA price of the reference unit using oracle prices and pool balances
    /// @dev Warning: Can revert
    /// @return low {UoA/ref}
    /// @return high {UoA/ref}
    function refPrice() internal view virtual override returns (uint192 low, uint192 high) {
        // Approach: Use oracle prices to imply balance ratios to expect in the pool,
        //           and use these ratios to propagate oracle prices through.

        // {UoA/underlyingPool}
        (uint192 lowPool, uint192 highPool) = super.refPrice();
        require(lowPool != 0, "inner pool has no value");

        // {UoA/pairedTok}
        (uint192 lowPaired, uint192 highPaired) = tryPairedPrice();
        require(lowPaired != 0, "invalid price");

        // Scale each token's price contribution by its expected % presence in the pool
        uint192 pool = FIX_ONE.div((lowPool + highPool) / 2); // {underlyingPool/UoA}
        uint192 paired = FIX_ONE.div((lowPaired + highPaired) / 2); // {pairedTok/UoA}
        uint192 norm = pool + paired;
        low += lowPool.mulDiv(pool, norm, FLOOR) + lowPaired.mulDiv(paired, norm, FLOOR);
        high += highPool.mulDiv(pool, norm, CEIL) + highPaired.mulDiv(paired, norm, CEIL);
    }
}
