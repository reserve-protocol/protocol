// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "hardhat/console.sol";

import "contracts/plugins/mocks/ERC20Mock.sol";
import "contracts/fuzz/IRewarder.sol";

contract RewarderMock is IRewarderMock {
    // I'm keeping this as simple as I can, while still providing fuzz-random behavior

    // rewards[tkn] is the reward amount for collateral `tkn`.
    mapping(address => uint256) public rewards;
    address[] public tokens;

    function setReward(address token, uint256 amount) public {
        if (address(rewards[token].token) == address(0)) tokens.push(token);
        rewards[token] = amount;
    }

    function rewardERC20(address erc20) public view returns (IERC20) {
        return IERC20(address(rewards[erc20].token));
    }

    // Update fuzz-random values from `seed`
    function update(uint256 a, uint256 b) public {
        if (tokens.length == 0) return;
        uint256 amount = a % 1e29; // 1e29 is our maximum "reasonable" quantity of reward tokens
        uint256 id = b % tokens.length;
        rewards[tokens[id]].amount = amount;
    }

    // Send any rewards due to `who` on `token`,
    function claimRewards(address who, address token) public {
        if (IERC20(token).balanceOf(who) == 0) return;
        if (rewards[token] == 0) return;
        rewardToken = reward.token.mint(who, rewards[token]);

        require(reward.token.totalSupply() <= 1e29, "Exceeded reasonable maximum of reward tokens");
    }
}
