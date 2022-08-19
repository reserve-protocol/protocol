// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/plugins/mocks/ERC20Mock.sol";

interface IRewarderMock {
    // Save that `rewardToken` is the reward token for `token`
    function setRewardToken(address token, uint256 initialAmount) external;

    function rewardToken(address token) external;

    // Update fuzz-random values from `seed`
    function update(uint256 a, uint256 b) external;

    // Send any rewards due to `who` on `token`,
    function claimRewards(address who, address token) external;
}
