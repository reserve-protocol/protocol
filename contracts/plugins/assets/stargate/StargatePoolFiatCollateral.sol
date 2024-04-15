// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "../../../libraries/Fixed.sol";
import "../AppreciatingFiatCollateral.sol";
import "./interfaces/IStargatePool.sol";
import "./StargateRewardableWrapper.sol";

/**
 * @title StargatePoolFiatCollateral
 * @notice Collateral plugin for Stargate USD Stablecoins,
 * tok = wstgUSDC / wstgUSDT
 * ref = USDC / USDT
 * tar = USD
 * UoA = USD
 */
contract StargatePoolFiatCollateral is AppreciatingFiatCollateral {
    IStargatePool private immutable pool;

    IERC20 private immutable stg;

    /// @param config.erc20 StargateRewardableWrapper
    /// @param config.chainlinkFeed Feed units: {UoA/ref}
    // solhint-disable no-empty-blocks
    constructor(CollateralConfig memory config, uint192 revenueHiding)
        AppreciatingFiatCollateral(config, revenueHiding)
    {
        require(config.defaultThreshold != 0, "defaultThreshold zero");
        pool = StargateRewardableWrapper(address(config.erc20)).pool();
        stg = StargateRewardableWrapper(address(config.erc20)).rewardToken();
    }

    /// @return _rate {ref/tok} Quantity of whole reference units per whole collateral tokens
    function underlyingRefPerTok() public view virtual override returns (uint192) {
        uint256 _totalSupply = pool.totalSupply();
        uint192 _rate = FIX_ONE; // 1:1 if pool has no tokens at all
        if (_totalSupply != 0) {
            _rate = divuu(pool.totalLiquidity(), _totalSupply);
        }

        return _rate;
    }

    function claimRewards() external override(Asset, IRewardable) {
        uint256 _bal = stg.balanceOf(address(this));
        IRewardable(address(erc20)).claimRewards();
        emit RewardsClaimed(stg, stg.balanceOf(address(this)) - _bal);
    }
}
