// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "./IComponent.sol";
import "./IMain.sol";

interface IRewardable is IComponent {
    /// Emitted whenever rewards are claimed
    event RewardsClaimed(address indexed erc20, uint256 indexed amount);

    function claimAndSweepRewards() external;
}
