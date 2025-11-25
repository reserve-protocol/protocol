// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.28;

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
 * @title AerodromeVolatileCollateral
 *  This plugin contract is designed for Aerodrome volatile pools
 *  Each token in the pool can have between 1 and 2 oracles per each token.
 *
 * There is no appreciation, only AERO rewards.
 *
 * tok = AerodromeStakingWrapper(volatilePool)
 * ref = LP token /w shift
 * tar = LP token /w shift
 * UoA = USD
 *
 */
contract AerodromeVolatileCollateral is FiatCollateral, AerodromePoolTokens {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    /// @dev config Unused members: chainlinkFeed, oracleError, oracleTimout
    /// @dev No revenue hiding (refPerTok() is constant)
    /// @dev config.erc20 should be an AerodromeStakingWrapper
    constructor(CollateralConfig memory config, APTConfiguration memory aptConfig)
        FiatCollateral(config)
        AerodromePoolTokens(aptConfig)
    {
        assert((token0.decimals() + token1.decimals()) % 2 == 0);
        assert(pool.decimals() == 18);
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
        uint192 r0 = tokenReserve(0); // {ref_0}
        uint192 r1 = tokenReserve(1); // {ref_1}

        // x * y >= k for vAMM pools
        uint192 sqrtReserve = r0.mul(r1, ROUND).sqrt();

        // get token prices
        (uint192 p0_low, uint192 p0_high) = tokenPrice(0); // {UoA/ref_0}
        (uint192 p1_low, uint192 p1_high) = tokenPrice(1); // {UoA/ref_1}

        // all aero pools have 18 decimals already
        uint192 totalSupply = _safeWrap(pool.totalSupply());

        // low
        uint192 sqrtPriceLow = p0_high.div(p1_low, CEIL).sqrt();
        low = sqrtReserve.mulDiv(p0_low, sqrtPriceLow, FLOOR).mulDiv(2e18, totalSupply, FLOOR);

        // high
        uint192 sqrtPriceHigh = p0_low.div(p1_high, FLOOR).sqrt();
        high = sqrtReserve.mulDiv(p0_high, sqrtPriceHigh, CEIL).mulDiv(2e18, totalSupply, CEIL);

        assert(low <= high); // not obviously true just by inspection

        pegPrice = 0; //  no default checks or issuance premium
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

    /// @return {ref/tok} Actual quantity of whole reference units per whole collateral tokens
    function refPerTok() public view virtual override returns (uint192) {
        int8 shift = 18 - int8((token0.decimals() + token1.decimals()) / 2);
        return shiftl_toFix(2, shift, FLOOR);
    }

    // === Internal ===

    // Override this later to implement non-stable pools
    function _anyDepeggedInPool() internal view virtual returns (bool) {
        // TODO maybe expand plugin later to support peg checks, currently not worth it
        return false;
    }
}
