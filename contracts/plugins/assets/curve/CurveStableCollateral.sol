// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "contracts/interfaces/IAsset.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/plugins/assets/AppreciatingFiatCollateral.sol";
import "../curve/PoolTokens.sol";

/**
 * @title CurveStableCollateral
 *  This plugin contract is fully general to any number of (fiat) tokens in a Curve stable pool,
 *  whether this LP token ends up staked in Curve, Convex, Frax, or somewhere else.
 *  Each token in the pool can have between 1 and 2 oracles per each token.
 *  Stable means only like-kind pools.
 *
 * tok = ConvexStakingWrapper(stablePlainPool)
 * ref = stablePlainPool pool invariant
 * tar = USD
 * UoA = USD
 *
 * @notice Curve pools with native ETH or ERC777 should be avoided,
 *  see docs/collateral.md for information
 */
contract CurveStableCollateral is AppreciatingFiatCollateral, PoolTokens {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    /// @dev config Unused members: chainlinkFeed, oracleError, oracleTimeout
    /// @dev config.erc20 should be a RewardableERC20
    constructor(
        CollateralConfig memory config,
        uint192 revenueHiding,
        PTConfiguration memory ptConfig
    ) AppreciatingFiatCollateral(config, revenueHiding) PoolTokens(ptConfig) {
        require(config.defaultThreshold > 0, "defaultThreshold zero");
    }

    /// Can revert, used by other contract functions in order to catch errors
    /// Should not return FIX_MAX for low
    /// Should only return FIX_MAX for high if low is 0
    /// @dev Override this when pricing is more complicated than just a single oracle
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
        // {UoA/ref} -- units will change
        (low, high) = refPrice();

        // {ref/tok}
        uint192 underlyingRefPerTok_ = underlyingRefPerTok();

        // {UoA/tok} = {UoA/ref} * {ref/tok}
        low = low.mul(underlyingRefPerTok_, FLOOR);
        high = high.mul(underlyingRefPerTok_, CEIL);
        assert(low <= high); // not obviously true just by inspection

        return (low, high, 0);
    }

    /// Should not revert
    /// Refresh exchange rates and update default status.
    /// Have to override to add custom default checks
    function refresh() public virtual override {
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
            try this.tryPrice() returns (uint192 low, uint192 high, uint192) {
                // {UoA/tok}, {UoA/tok}, {UoA/tok}
                // (0, 0) is a valid price; (0, FIX_MAX) is unpriced

                // Save prices if priced
                if (high < FIX_MAX) {
                    savedLowPrice = low;
                    savedHighPrice = high;
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

    /// Claim rewards earned by holding a balance of the ERC20 token
    /// DEPRECATED: claimRewards() will be removed from all assets and collateral plugins
    function claimRewards() external virtual override(Asset, IRewardable) {
        IRewardable(address(erc20)).claimRewards();
    }

    // === Internal ===

    /// Return the UoA price of the reference unit using oracle prices and pool balances
    /// @dev Warning: Can revert
    /// @return low {UoA/ref}
    /// @return high {UoA/ref}
    function refPrice() internal view virtual returns (uint192 low, uint192 high) {
        // Approach: Use oracle prices to imply balance ratios to expect in the pool,
        //           and use these ratios to propagate oracle prices through.
        //
        // Example:
        //   - pool with 2 tokens where 1 half-defaults: $1 and $1 => $1 and $0.5
        //   - first token becomes 1/3 of the pool, second token becomes 2/3 of the pool
        //   - 1/3 * $1 + 2/3 * $0.5 = $0.66

        uint192[] memory lows = new uint192[](nTokens); // {UoA/ref}
        uint192[] memory highs = new uint192[](nTokens); // {UoA/ref}
        uint192[] memory portions = new uint192[](nTokens); // {ref/UoA}
        uint192 norm; // {ref/UoA}

        // Compute norm
        for (uint8 i = 0; i < nTokens; i++) {
            (lows[i], highs[i]) = tokenPrice(i); // {UoA/ref}
            require(lows[i] != 0, "pool has no value");

            // {ref/UoA} = {1} / ({UoA/ref} + {UoA/ref})
            portions[i] = FIX_ONE.div((lows[i] + highs[i]) / 2);
            norm += portions[i];
        }

        // Scale each token's price contribution by its expected % presence in the pool
        for (uint8 i = 0; i < nTokens; i++) {
            // {UoA/ref} = {UoA/ref} * {ref} / {ref}
            low += lows[i].mulDiv(portions[i], norm, FLOOR);
            high += highs[i].mulDiv(portions[i], norm, CEIL);
        }
    }

    /// @return {ref/tok} Actual quantity of whole reference units per whole collateral tokens
    function underlyingRefPerTok() public view virtual override returns (uint192) {
        return _safeWrap(curvePool.get_virtual_price());
    }

    // Override this later to implement non-stable pools
    function _anyDepeggedInPool() internal view virtual returns (bool) {
        // Check reference token oracles
        for (uint8 i = 0; i < nTokens; i++) {
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

    // Override this in child classes to implement metapools
    function _anyDepeggedOutsidePool() internal view virtual returns (bool) {
        return false;
    }
}
