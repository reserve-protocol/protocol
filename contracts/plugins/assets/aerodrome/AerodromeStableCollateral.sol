// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "contracts/interfaces/IAsset.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/plugins/assets/FiatCollateral.sol";
import "../../../interfaces/IRewardable.sol";
import "./AerodromePoolTokens.sol";

// This plugin only works on Base
IERC20 constant AERO = IERC20(0x940181a94A35A4569E4529A3CDfB74e38FD98631);

/**
 * @title AerodromeStableCollateral
 *  This plugin contract is designed for Aerodrome stable pools
 *  Each token in the pool can have between 1 and 2 oracles per each token.
 *
 * tok = AerodromeStakingWrapper(stablePool)
 * ref = 1e18 (fixed)
 * tar = USD
 * UoA = USD
 *
 */
contract AerodromeStableCollateral is FiatCollateral, AerodromePoolTokens {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    /// @dev config Unused members: chainlinkFeed, oracleError, oracleTimeout
    /// @dev No revenue hiding (refPerTok() == FIX_ONE)
    /// @dev config.erc20 should be an AerodromeStakingWrapper
    constructor(CollateralConfig memory config, APTConfiguration memory aptConfig)
        FiatCollateral(config)
        AerodromePoolTokens(aptConfig)
    {
        require(config.defaultThreshold != 0, "defaultThreshold zero");
        maxOracleTimeout = uint48(Math.max(maxOracleTimeout, maxPoolOracleTimeout()));
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
        // get reserves
        uint192 r0 = shiftl_toFix(tokenReserve(0), -int8(token0.decimals()), FLOOR);
        uint192 r1 = shiftl_toFix(tokenReserve(1), -int8(token1.decimals()), FLOOR);
        uint192 totalSupply = shiftl_toFix(pool.totalSupply(), -int8(pool.decimals()), FLOOR);
        uint192 sqrtK = (r0.sqrt()).mulDiv(r1.sqrt(), totalSupply);

        // get token prices
        (uint192 p0_low, uint192 p0_high) = tokenPrice(0);
        (uint192 p1_low, uint192 p1_high) = tokenPrice(1);

        // {UoA/tok}
        low = sqrtK.mul(2).mul(((p0_low.mul(p1_low)).sqrt()));
        high = sqrtK.mul(2).mul(((p0_high.mul(p1_high)).sqrt()));

        assert(low <= high); //obviously true just by inspection
        pegPrice = FIX_ONE;
    }

    /// Should not revert
    /// Refresh exchange rates and update default status.
    /// Have to override to add custom default checks
    function refresh() public virtual override {
        CollateralStatus oldStatus = status();

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
            if (low == 0 || _anyDepeggedInPool()) {
                markStatus(CollateralStatus.IFFY);
            } else {
                markStatus(CollateralStatus.SOUND);
            }
        } catch (bytes memory errData) {
            // see: docs/solidity-style.md#Catching-Empty-Data
            if (errData.length == 0) revert(); // solhint-disable-line reason-string
            markStatus(CollateralStatus.IFFY);
        }

        CollateralStatus newStatus = status();
        if (oldStatus != newStatus) {
            emit CollateralStatusChanged(oldStatus, newStatus);
        }
    }

    /// Claim rewards earned by holding a balance of the ERC20 token
    /// @custom:delegate-call
    function claimRewards() external virtual override(Asset, IRewardable) {
        uint256 aeroBal = AERO.balanceOf(address(this));
        IRewardable(address(erc20)).claimRewards();
        emit RewardsClaimed(AERO, AERO.balanceOf(address(this)) - aeroBal);
    }

    // === Internal ===

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
}
