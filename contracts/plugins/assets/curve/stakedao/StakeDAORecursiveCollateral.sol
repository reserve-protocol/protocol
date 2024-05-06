// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "../CurveRecursiveCollateral.sol";
import "./IStakeDAO.sol";

/**
 * @title StakeDAORecursiveCollateral
 * @notice Collateral plugin for a StakeDAO sdUSDC+LP-f-gauge corresponding
 *   to a Curve pool with a reference token and an RToken. The RToken must
 *   be strictly up-only with respect to the reference token.
 *
 * tok = sdUSDC+LP-f-gauge
 * ref = USDC
 * tar = USD
 * UoA = USD
 */
contract StakeDAORecursiveCollateral is CurveRecursiveCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    IStakeDAOGauge internal immutable gauge; // typed erc20 variable
    IStakeDAOClaimer internal immutable claimer;

    /// @param config.erc20 must be of type IStakeDAOGauge
    /// @param config.chainlinkFeed Feed units: {UoA/ref}
    constructor(
        CollateralConfig memory config,
        uint192 revenueHiding,
        PTConfiguration memory ptConfig
    ) CurveRecursiveCollateral(config, revenueHiding, ptConfig) {
        gauge = IStakeDAOGauge(address(config.erc20));
        claimer = gauge.claimer();
    }

    /// @custom:delegate-call
    function claimRewards() external override {
        uint256 count = gauge.reward_count();

        // Save initial bals
        IERC20Metadata[] memory rewardTokens = new IERC20Metadata[](count);
        uint256[] memory bals = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            rewardTokens[i] = gauge.reward_tokens(i);
            bals[i] = rewardTokens[i].balanceOf(address(this));
        }

        // Do actual claim
        address[] memory gauges = new address[](1);
        gauges[0] = address(gauge);
        claimer.claimRewards(gauges, false);

        // Emit balance changes
        for (uint256 i = 0; i < rewardTokens.length; i++) {
            IERC20Metadata rewardToken = rewardTokens[i];
            emit RewardsClaimed(rewardToken, rewardToken.balanceOf(address(this)) - bals[i]);
        }
    }
}
