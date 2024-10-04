// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "contracts/interfaces/IAsset.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/plugins/assets/AppreciatingFiatCollateral.sol";
import "../../../interfaces/IRewardable.sol";
import "../curve/PoolTokens.sol";

// Note: Needs to be changed if we ever use this contract on something other than mainnet
IERC20 constant CRV = IERC20(0xD533a949740bb3306d119CC777fa900bA034cd52);
IERC20 constant CVX = IERC20(0x4e3FBD56CD56c3e72c1403e103b45Db9da5B9D2B);

/**
 * @title CurveStableCollateral
 *  This plugin contract is fully general to any number of (fiat) tokens in a Curve stable pool,
 *  whether this LP token ends up staked in Curve, Convex, Frax, or somewhere else.
 *  Each token in the pool can have between 1 and 2 oracles per each token.
 *  Stable means only like-kind pools.
 *  Works for both CurveGaugeWrapper and ConvexStakingWrapper.
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
    /// @dev config.erc20 should be a CurveGaugeWrapper or ConvexStakingWrapper
    constructor(
        CollateralConfig memory config,
        uint192 revenueHiding,
        PTConfiguration memory ptConfig
    ) AppreciatingFiatCollateral(config, revenueHiding) PoolTokens(ptConfig) {
        require(config.defaultThreshold != 0, "defaultThreshold zero");
        maxOracleTimeout = uint48(Math.max(maxOracleTimeout, maxPoolOracleTimeout()));
    }

    /// Can revert, used by other contract functions in order to catch errors
    /// Should not return FIX_MAX for low
    /// Should only return FIX_MAX for high if low is 0
    /// Should NOT be manipulable by MEV
    /// @dev Override this when pricing is more complicated than just a single pool
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
        // TODO update this approach to be MEV-resistant

        // {UoA}
        (uint192 aumLow, uint192 aumHigh) = totalBalancesValue();

        // {tok}
        uint192 supply = shiftl_toFix(lpToken.totalSupply(), -int8(lpToken.decimals()), FLOOR);
        // We can always assume that the total supply is sufficiently non-zero

        // {UoA/tok} = {UoA} / {tok}
        low = aumLow.div(supply, FLOOR);
        high = aumHigh.div(supply, CEIL);
        assert(low <= high); // not obviously true just by inspection

        pegPrice = 0; // can't deduce from MEV-manipulable pricing unfortunately
        // no issuance premium! more dangerous to be used inside RTokens as a result
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
    /// @custom:delegate-call
    function claimRewards() external virtual override(Asset, IRewardable) {
        // Plugin can be used with either Curve or Convex wrappers
        // Here I prefer omitting any wrapper-specific logic at the cost of an additional event
        uint256 crvBal = CRV.balanceOf(address(this));
        uint256 cvxBal = CVX.balanceOf(address(this));
        IRewardable(address(erc20)).claimRewards();
        emit RewardsClaimed(CRV, CRV.balanceOf(address(this)) - crvBal);
        emit RewardsClaimed(CVX, CVX.balanceOf(address(this)) - cvxBal);
    }

    // === Internal ===

    /// @return {ref/tok} Actual quantity of whole reference units per whole collateral tokens
    function underlyingRefPerTok() public view virtual override returns (uint192) {
        return _safeWrap(curvePool.get_virtual_price());
    }

    // Override this later to implement non-stable pools
    function _anyDepeggedInPool() internal view virtual returns (bool) {
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

    // Override this in child classes to implement metapools
    function _anyDepeggedOutsidePool() internal view virtual returns (bool) {
        return false;
    }
}
