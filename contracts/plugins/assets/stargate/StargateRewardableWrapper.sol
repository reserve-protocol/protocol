// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity ^0.8.19;

import "./interfaces/IStargateLPStaking.sol";
import "./interfaces/IStargatePool.sol";
import "../erc20/RewardableERC20Wrapper.sol";

contract StargateRewardableWrapper is RewardableERC20Wrapper {
    IStargateLPStaking public immutable stakingContract;
    IStargatePool public immutable pool;
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
        require(address(stargate_) == address(stakingContract_.stargate()), "Wrong stargate");

        uint256 poolLength = stakingContract_.poolLength();
        uint256 pid = type(uint256).max;
        for (uint256 i = 0; i < poolLength; ++i) {
            if (address(stakingContract_.poolInfo(i).lpToken) == address(pool_)) {
                pid = i;
                break;
            }
        }
        require(pid != type(uint256).max, "Invalid pool");

        pool = pool_;
        poolId = pid;
        stakingContract = stakingContract_;
    }

    function _claimAssetRewards() internal override {
        if (stakingContract.totalAllocPoint() != 0) {
            stakingContract.deposit(poolId, 0);
        }
    }

    function _afterDeposit(uint256, address) internal override {
        uint256 underlyingBalance = underlying.balanceOf(address(this));
        IStargateLPStaking.PoolInfo memory poolInfo = stakingContract.poolInfo(poolId);

        if (poolInfo.allocPoint != 0 && underlyingBalance != 0) {
            pool.approve(address(stakingContract), underlyingBalance);
            stakingContract.deposit(poolId, underlyingBalance);
        }
    }

    function _beforeWithdraw(uint256 _amount, address) internal override {
        IStargateLPStaking.PoolInfo memory poolInfo = stakingContract.poolInfo(poolId);

        if (poolInfo.allocPoint != 0) {
            uint256 underlyingBalance = underlying.balanceOf(address(this));
            if (underlyingBalance < _amount) {
                stakingContract.withdraw(poolId, _amount - underlyingBalance);
            }
        } else {
            stakingContract.emergencyWithdraw(poolId);
        }
    }
}
