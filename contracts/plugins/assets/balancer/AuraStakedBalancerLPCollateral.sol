// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/utils/math/Math.sol";

import "./interfaces/IVault.sol";
import "./interfaces/ILiquidityGaugeFactory.sol";
import "./interfaces/IBalancerMinter.sol";
import "./interfaces/BPool.sol";

import "./interfaces/IBaseRewardPool.sol";

import "./BalancerLPCollateral.sol";
import "./AuraStakingWrapper.sol";
import "../SelfReferentialCollateral.sol";

struct StakedBalancerCollateralConfig {
    IERC20 aura; // balancer token
    IERC20 bal; // balancer token
    IBaseRewardPool baseRewardPool; // base reward pool - to get rewards from
}

// TODO: FINISH REWRITE THESE COMMENTS
/**
 * @title BalancerLPCollateral
 * Parent plugin for most Balancer LP Tokens
 *
 * For: {tok} != {ref}, {ref} != {target}, {target} == {UoA}
 * Can be easily extended by (optionally) re-implementing:
 *   - tryPrice()
 *   - targetPerRef()
 *   - claimRewards()
 */
contract AuraStakedBalancerLPCollateral is BalancerLPCollateral {
    using FixLib for uint192;
    using OracleLib for AggregatorV3Interface;

    // Default Status:
    // _whenDefault == NEVER: no risk of default (initial value)
    // _whenDefault > block.timestamp: delayed default may occur as soon as block.timestamp.
    //                In this case, the asset may recover, reachiving _whenDefault == NEVER.
    // _whenDefault <= block.timestamp: default has already happened (permanently)

    IBaseRewardPool public immutable baseRewardPool;
    IERC20 public immutable balToken;
    IERC20 public immutable auraToken;

    /// @dev config Unused members: chainlinkFeed, oracleError 
    /// @dev config.erc20 should be a IConvexStakingWrapper
    /// @param config.chainlinkFeed Feed units: {UoA/ref}
    constructor(CollateralConfig memory config, BalancerCollateralConfig memory balConfig, StakedBalancerCollateralConfig memory auraConfig)
        BalancerLPCollateral(
            config,
            balConfig
        )
    {
        require(address(auraConfig.bal) != address(0), "missing balancer token");
        balToken = auraConfig.bal;
        require(address(auraConfig.aura) != address(0), "missing aura token");
        auraToken = auraConfig.aura;
        require(address(auraConfig.baseRewardPool) != address(0), "missing baseRewardPool");
        baseRewardPool = auraConfig.baseRewardPool;
        require(config.delayUntilDefault <= 1209600, "delayUntilDefault too long");
    }

    // Claim balancer and aura token rewards 
    /// @dev Use delegatecall
    function claimRewards() external override(BalancerLPCollateral) {
        uint256 balOldBal = balToken.balanceOf(address(this));
        uint256 auraOldBal = auraToken.balanceOf(address(this));
        AuraStakingWrapper(address(erc20)).getReward(address(this));
        emit RewardsClaimed(balToken, balToken.balanceOf(address(this)) - balOldBal);
        emit RewardsClaimed(auraToken, auraToken.balanceOf(address(this)) - auraOldBal);
    }
}