// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity ^0.8.19;

import "./interfaces/IStargateLPStaking.sol";
import "./interfaces/IStargatePool.sol";

import "../erc20/RewardableERC20Wrapper.sol";

contract StargateRewardableWrapper is RewardableERC20Wrapper {
    IStargateLPStaking public immutable stakingContract;
    IStargatePool public immutable pool;
    IERC20 public immutable stargate;
    uint256 public immutable poolId;

    constructor(
        string memory name_,
        string memory symbol_,
        IERC20 stargate_,
        IStargateLPStaking stakingContract_,
        IStargatePool pool_
    ) RewardableERC20Wrapper(pool_, name_, symbol_, stargate_) {
        require(
            address(stargate_) != address(0) &&
                address(stakingContract_) != address(0) &&
                address(pool_) != address(0),
            "Invalid address"
        );

        uint256 poolLength = stakingContract_.poolLength();
        uint256 pid = type(uint256).max;
        for (uint256 i = 0; i < poolLength; ++i) {
            if (address(stakingContract_.poolInfo(i).lpToken) == address(pool_)) {
                pid = i;
                break;
            }
        }
        require(pid != type(uint256).max, "Invalid pool");

        pool_.approve(address(stakingContract_), type(uint256).max); // TODO: Change this!

        pool = pool_;
        poolId = pid;
        stakingContract = stakingContract_;
        stargate = stargate_;
    }

    function _claimAssetRewards() internal override {
        stakingContract.deposit(poolId, 0);
    }

    function _afterDeposit(uint256 _amount, address to) internal override {
        require(to == msg.sender, "Only the sender can deposit");

        stakingContract.deposit(poolId, _amount);
    }

    function _beforeWithdraw(uint256 _amount, address to) internal override {
        require(to == msg.sender, "Only the sender can withdraw");

        stakingContract.withdraw(poolId, _amount);
    }
}
