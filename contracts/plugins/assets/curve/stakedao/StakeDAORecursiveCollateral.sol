// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "../CurveRecursiveCollateral.sol";

interface IStakeDAOVault is IERC20Metadata {
    function token() external view returns (IERC20Metadata);

    function liquidityGauge() external view returns (IStakeDAOGauge);
}

interface IStakeDAOGauge {
    function claimer() external view returns (IStakeDAOClaimer);

    function reward_count() external view returns (uint256);

    function reward_tokens(uint256 index) external view returns (IERC20Metadata);
}

interface IStakeDAOClaimer {
    function claimRewards(address[] memory gauges, bool claimVeSDT) external;
}

/**
 * @title StakeDAORecursiveCollateral
 * @notice Collateral plugin for a StakeDAO USDC+LP-f Vault that contains
 *   a Curve pool with a reference token and an RToken. The RToken can be
 *   of like kind of up-only in relation to the reference token.
 *
 * tok = sdUSDC+LP-f Vault
 * ref = USDC
 * tar = USD
 * UoA = USD
 */
contract StakeDAORecursiveCollateral is CurveRecursiveCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    IStakeDAOGauge internal immutable gauge;
    IStakeDAOClaimer internal immutable claimer;

    /// @param config.erc20 must be of type IStakeDAOVault
    /// @param config.chainlinkFeed Feed units: {UoA/ref}
    constructor(
        CollateralConfig memory config,
        uint192 revenueHiding,
        PTConfiguration memory ptConfig
    ) CurveRecursiveCollateral(config, revenueHiding, ptConfig) {
        IStakeDAOVault vault = IStakeDAOVault(address(config.erc20));
        gauge = vault.liquidityGauge();
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
