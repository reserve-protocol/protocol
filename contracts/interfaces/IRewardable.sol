// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./IComponent.sol";
import "./IMain.sol";

/**
 * @title IRewardable
 * @notice A simple interface mixin to support claiming of rewards.
 */
interface IRewardable {
    /// Emitted whenever a reward token balance is claimed
    event RewardsClaimed(IERC20 indexed erc20, uint256 indexed amount);

    /// Claim rewards earned by holding a balance of the ERC20 token
    /// Must emit `RewardsClaimed` for each token rewards are claimed for
    /// @dev delegatecall: there be dragons here!
    /// @custom:interaction
    function claimRewards() external;
}

/**
 * @title IRewardableComponent
 * @notice A simple interface mixin to support claiming of rewards.
 */
interface IRewardableComponent is IRewardable {
    /// Claim rewards for a single ERC20
    /// Must emit `RewardsClaimed` for each token rewards are claimed for
    /// @dev delegatecall: there be dragons here!
    /// @custom:interaction
    function claimRewardsSingle(IERC20 erc20) external;
}
