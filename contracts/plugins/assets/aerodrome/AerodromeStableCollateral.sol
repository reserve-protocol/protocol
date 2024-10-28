// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "./AerodromeVolatileCollateral.sol";

/**
 * @title AerodromeStableCollateral
 *  This plugin contract is designed for Aerodrome stable pools
 *  Each token in the pool can have between 1 and 2 oracles per each token.
 *
 * tok = AerodromeStakingWrapper(stablePool)
 * ref = LP token /w shift
 * tar = USD
 * UoA = USD
 *
 */
contract AerodromeStableCollateral is AerodromeVolatileCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    /// @dev config Unused members: chainlinkFeed, oracleError, oracleTimeout
    /// @dev No revenue hiding (refPerTok() == FIX_ONE)
    /// @dev config.erc20 should be an AerodromeStakingWrapper
    constructor(CollateralConfig memory config, APTConfiguration memory aptConfig)
        AerodromeVolatileCollateral(config, aptConfig)
    {
        require(config.defaultThreshold != 0, "defaultThreshold zero");
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
        uint256 r0 = tokenReserve(0);
        uint256 r1 = tokenReserve(1);

        // xy^3 + yx^3 >= k for sAMM pools
        uint256 sqrtReserve = sqrt256(sqrt256(r0 * r1) * sqrt256(r0 * r0 + r1 * r1));

        // get token prices
        (uint192 p0_low, uint192 p0_high) = tokenPrice(0);
        (uint192 p1_low, uint192 p1_high) = tokenPrice(1);

        uint192 totalSupply = shiftl_toFix(pool.totalSupply(), -int8(pool.decimals()), FLOOR);

        // low
        {
            uint256 ratioLow = ((1e18) * p0_high) / p1_low;
            uint256 sqrtPriceLow = sqrt256(
                sqrt256((1e18) * ratioLow) * sqrt256(1e36 + ratioLow * ratioLow)
            );
            low = _safeWrap(((((1e18) * sqrtReserve) / sqrtPriceLow) * p0_low * 2) / totalSupply);
        }
        // high
        {
            uint256 ratioHigh = ((1e18) * p0_low) / p1_high;
            uint256 sqrtPriceHigh = sqrt256(
                sqrt256((1e18) * ratioHigh) * sqrt256(1e36 + ratioHigh * ratioHigh)
            );

            high = _safeWrap(
                ((((1e18) * sqrtReserve) / sqrtPriceHigh) * p0_high * 2) / totalSupply
            );
        }
        assert(low <= high); //obviously true just by inspection

        // {target/ref} = {UoA/ref} = {UoA/tok} / ({ref/tok}
        // {target/ref} and {UoA/ref} are the same since target == UoA
        pegPrice = ((low + high) / 2).div(refPerTok());
    }

    // === Internal ===

    function _anyDepeggedInPool() internal view virtual override returns (bool) {
        // Check reference token oracles
        for (uint8 i = 0; i < nTokens; ++i) {
            try this.tokenPrice(i) returns (uint192 low, uint192 high) {
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
        }

        return false;
    }
}
