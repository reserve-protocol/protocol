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

struct RewardType {
    address reward_token;
    uint128 reward_integral;
    uint128 reward_remaining;
}

interface IConvexRewardPool is IERC20Metadata {
    function rewardLength() external view returns (uint256);

    function rewards(uint256 _rewardIndex) external view returns (RewardType memory);

    function getReward(address) external;
}

/**
 * @title L2ConvexStableCollateral
 *  This plugin contract is designed for any number of (fiat) tokens in a Convex stable pool,
 *  Each token in the pool can have between 1 and 2 oracles per each token.
 *  Stable means only like-kind pools.
 *
 * tok = Convex LP (stablePlainPool) - no wrapper needed in L2
 * ref = stablePlainPool pool invariant
 * tar = USD
 * UoA = USD
 *
 * @notice Pools with native ETH or ERC777 should be avoided,
 *  see docs/collateral.md for information
 */
contract L2ConvexStableCollateral is AppreciatingFiatCollateral, PoolTokens {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    /// @dev config Unused members: chainlinkFeed, oracleError, oracleTimeout
    /// @dev config.erc20 should be the Convex Rewards Pool (no wrapper required)
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
    /// @dev Override this when pricing is more complicated than just a single pool
    /// @return low {UoA/tok} The low price estimate
    /// @return high {UoA/tok} The high price estimate
    /// @return {target/ref} Unused. Always 0
    function tryPrice()
        external
        view
        virtual
        override
        returns (uint192 low, uint192 high, uint192)
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

        // {UoA}
        (uint192 aumLow, uint192 aumHigh) = totalBalancesValue();

        // {tok}
        uint192 supply = shiftl_toFix(lpToken.totalSupply(), -int8(lpToken.decimals()));
        // We can always assume that the total supply is non-zero

        // {UoA/tok} = {UoA} / {tok}
        low = aumLow.div(supply, FLOOR);
        high = aumHigh.div(supply, CEIL);
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
                if (high != FIX_MAX) {
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
    /// @custom:delegate-call
    function claimRewards() external virtual override(Asset, IRewardable) {
        uint256 count = IConvexRewardPool(address(erc20)).rewardLength();

        // Save initial bals
        IERC20Metadata[] memory rewardTokens = new IERC20Metadata[](count);
        uint256[] memory bals = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
             RewardType memory _reward = IConvexRewardPool(address(erc20)).rewards(i);
            rewardTokens[i] = IERC20Metadata(_reward.reward_token);
            bals[i] = rewardTokens[i].balanceOf(address(this));
        }

        // Claim rewards
        IConvexRewardPool(address(erc20)).getReward(address(this));

        // Emit balance changes
        for (uint256 i = 0; i < rewardTokens.length; i++) {
            IERC20Metadata rewardToken = rewardTokens[i];
            emit RewardsClaimed(rewardToken, rewardToken.balanceOf(address(this)) - bals[i]);
        }
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
