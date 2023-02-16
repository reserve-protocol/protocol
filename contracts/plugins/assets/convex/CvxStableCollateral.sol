// SPDX-License-Identifier: ISC
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "contracts/interfaces/IAsset.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/plugins/assets/AppreciatingFiatCollateral.sol";
import "./PoolTokens.sol";

interface IConvexStakingWrapper {
    function crv() external returns (address);

    function cvx() external returns (address);

    function getReward(address _account) external;
}

/**
 * @title CvxStableCollateral
 *  This plugin contract is fully general to any number of tokens in a stable pool,
 *  with between 1 and 2 oracles per each token. Stable means only like-kind pools.
 */
contract CvxStableCollateral is AppreciatingFiatCollateral, PoolTokens {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    /// @param config Unused members: chainlinkFeed, oracleError, oracleTimeout
    /// @dev config.erc20 should be a IConvexStakingWrapper
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

        // {tok}
        uint192 supply = shiftl_toFix(erc20.totalSupply(), -int8(erc20Decimals));

        // {UoA}
        (uint192 aumLow, uint192 aumHigh) = totalBalancesValue();

        // {UoA/tok} = {UoA} / {tok}
        pegPrice = ((aumLow + aumHigh) / 2).div(supply); // use avg of aumLow + aumHigh

        // discount aumLow by the amount of revenue being hidden
        // {UoA} = {UoA} * {ref/tok} / {ref/tok}
        aumLow = aumLow.mulDiv(exposedReferencePrice, _underlyingRefPerTok());

        // {UoA/tok} = {UoA} / {tok}
        low = aumLow.div(supply);
        high = aumHigh.div(supply);
    }

    /// Should not revert
    /// Refresh exchange rates and update default status.
    /// Have to override to add custom default checks
    function refresh() public virtual override {
        if (alreadyDefaulted()) {
            // continue to update rates
            exposedReferencePrice = _underlyingRefPerTok().mul(revenueShowing);
            return;
        }

        CollateralStatus oldStatus = status();

        // Check for hard default
        // must happen before tryPrice() call since `refPerTok()` returns a stored value

        // revenue hiding: do not DISABLE if drawdown is small
        uint192 underlyingRefPerTok = _underlyingRefPerTok();

        // {ref/tok} = {ref/tok} * {1}
        uint192 hiddenReferencePrice = underlyingRefPerTok.mul(revenueShowing);

        // uint192(<) is equivalent to Fix.lt
        if (underlyingRefPerTok < exposedReferencePrice) {
            exposedReferencePrice = hiddenReferencePrice;
            markStatus(CollateralStatus.DISABLED);
        } else if (hiddenReferencePrice > exposedReferencePrice) {
            exposedReferencePrice = hiddenReferencePrice;
        }

        // Check for soft default + save prices
        try this.tryPrice() returns (uint192 low, uint192 high, uint192 pegPrice) {
            // {UoA/tok}, {UoA/tok}, {UoA/tok}
            // (0, 0) is a valid price; (0, FIX_MAX) is unpriced

            // Save prices if priced
            if (high < FIX_MAX) {
                savedLowPrice = low;
                savedHighPrice = high;
                lastSave = uint48(block.timestamp);
            } else {
                // must be unpriced
                assert(low == 0);
            }

            // If the price is below the default-threshold price, default eventually
            // uint192(+/-) is the same as Fix.plus/minus
            if (pegPrice < pegBottom || pegPrice > pegTop || low == 0 || _anyDepegged()) {
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
    /// @dev Use delegatecall
    function claimRewards() external override(Asset, IRewardable) {
        IConvexStakingWrapper wrapper = IConvexStakingWrapper(address(erc20));
        IERC20 cvx = IERC20(wrapper.cvx());
        IERC20 crv = IERC20(wrapper.crv());
        uint256 cvxOldBal = cvx.balanceOf(address(this));
        uint256 crvOldBal = crv.balanceOf(address(this));
        wrapper.getReward(address(this));
        emit RewardsClaimed(cvx, cvx.balanceOf(address(this)) - cvxOldBal);
        emit RewardsClaimed(crv, crv.balanceOf(address(this)) - crvOldBal);
    }

    // === Internal ===

    /// @return {ref/tok} Actual quantity of whole reference units per whole collateral tokens
    function _underlyingRefPerTok() internal view override returns (uint192) {
        return _safeWrap(curvePool.get_virtual_price());
    }

    // Override this later to implement non-stable pools
    function _anyDepegged() internal view virtual returns (bool) {
        // Check reference token oracles
        for (uint8 i = 0; i < nTokens; i++) {
            try this.tokenPrice(i) returns (uint192 low, uint192 high) {
                // {UoA/tok} = {UoA/tok} + {UoA/tok}
                uint192 mid = low + high / 2;

                // If the price is below the default-threshold price, default eventually
                // uint192(+/-) is the same as Fix.plus/minus
                if (mid < pegBottom || mid > pegTop) return true;
            } catch (bytes memory errData) {
                // see: docs/solidity-style.md#Catching-Empty-Data
                if (errData.length == 0) revert(); // solhint-disable-line reason-string
                return true;
            }
        }

        return false;
    }
}
