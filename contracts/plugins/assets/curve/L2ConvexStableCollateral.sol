// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "./CurveStableCollateral.sol";

struct RewardType {
    // solhint-disable-next-line var-name-mixedcase
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
 *  This plugin is designed for any number of (fiat) tokens in a Convex L2 stable pool.
 *  Each token in the pool can have between 1 and 2 oracles per each token.
 *  Stable means only like-kind pools.
 *
 * tok = Convex Rewards Pool (stablePlainPool) - no wrapper needed in L2
 * ref = stablePlainPool pool invariant
 * tar = USD
 * UoA = USD
 *
 * @notice Pools with native ETH or ERC777 should be avoided,
 *  see docs/collateral.md for information
 */
contract L2ConvexStableCollateral is CurveStableCollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    /// @dev config Unused members: chainlinkFeed, oracleError, oracleTimeout
    /// @dev config.erc20 should be the Convex Rewards Pool (no wrapper required)
    constructor(
        CollateralConfig memory config,
        uint192 revenueHiding,
        PTConfiguration memory ptConfig
    ) CurveStableCollateral(config, revenueHiding, ptConfig) {}

    /// Claim rewards earned by holding a balance of the ERC20 token
    /// @custom:delegate-call
    function claimRewards() external virtual override(CurveStableCollateral) {
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
}
