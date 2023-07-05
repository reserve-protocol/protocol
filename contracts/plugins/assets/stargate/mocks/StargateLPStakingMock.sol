// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "../interfaces/IStargateLPStaking.sol";
import "../../../mocks/ERC20Mock.sol";

contract StargateLPStakingMock is IStargateLPStaking {
    PoolInfo[] private _poolInfo;
    mapping(uint256 => mapping(address => uint256)) poolToUserRewardsPending;
    mapping(uint256 => mapping(address => uint256)) poolToUserBalance;

    ERC20Mock public immutable stargateMock;

    constructor(ERC20Mock stargateMock_) {
        stargateMock = stargateMock_;
    }

    function poolLength() external view override returns (uint256) {
        return _poolInfo.length;
    }

    function pendingStargate(uint256 pid, address user) external view override returns (uint256) {
        return poolToUserRewardsPending[pid][user];
    }

    function poolInfo(uint256 index) external view override returns (PoolInfo memory) {
        return _poolInfo[index];
    }

    function updatePool(uint256 pid) external override {}

    function deposit(uint256 pid, uint256 amount) external override {
        address sender = msg.sender;
        IERC20 pool = _poolInfo[pid].lpToken;
        pool.transferFrom(sender, address(this), amount);
        _emitUserRewards(pid, sender);
        poolToUserBalance[pid][sender] += amount;
    }

    function withdraw(uint256 pid, uint256 amount) external override {
        address sender = msg.sender;
        require(amount <= poolToUserBalance[pid][sender]);
        IERC20 pool = _poolInfo[pid].lpToken;
        pool.transfer(sender, amount);
        _emitUserRewards(pid, sender);
        poolToUserBalance[pid][sender] -= amount;
    }

    function emergencyWithdraw(uint256 pid) external override {}

    function addRewardsToUser(
        uint256 pid,
        address user,
        uint256 amount
    ) external {
        poolToUserRewardsPending[pid][user] += amount;
    }

    function addPool(IERC20 lpToken) internal {
        PoolInfo memory info;
        info.lpToken = lpToken;
        _poolInfo.push(info);
    }

    function _emitUserRewards(uint256 pid, address user) private {
        uint256 amount = poolToUserRewardsPending[pid][user];
        stargateMock.mint(user, amount);
        poolToUserRewardsPending[pid][user] = 0;
    }

    function add(uint256, IERC20 lpToken) external override {
        addPool(lpToken);
    }

    function owner() external view override returns (address) {}
}
