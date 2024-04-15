// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "../interfaces/IStargateLPStaking.sol";
import "../../../mocks/ERC20Mock.sol";

contract StargateLPStakingMock is IStargateLPStaking {
    PoolInfo[] private _poolInfo;
    mapping(uint256 => mapping(address => uint256)) poolToUserRewardsPending;
    mapping(uint256 => mapping(address => uint256)) poolToUserBalance;

    ERC20Mock public immutable stargateMock;
    address public immutable stargate;
    address public immutable eToken;

    uint256 public totalAllocPoint = 0;

    uint256 public availableRewards = type(uint256).max;

    constructor(ERC20Mock stargateMock_) {
        stargateMock = stargateMock_;
        stargate = address(stargateMock_);
        eToken = address(stargateMock_);
    }

    function poolLength() external view override returns (uint256) {
        return _poolInfo.length;
    }

    function setAvailableRewards(uint256 amount) external {
        availableRewards = amount;
    }

    function pendingEmissionToken(uint256 pid, address user)
        external
        view
        override
        returns (uint256)
    {
        return poolToUserRewardsPending[pid][user];
    }

    function poolInfo(uint256 index) external view override returns (PoolInfo memory) {
        return _poolInfo[index];
    }

    function updatePool(uint256 pid) external override {}

    function deposit(uint256 pid, uint256 amount) external override {
        IERC20 pool = _poolInfo[pid].lpToken;
        pool.transferFrom(msg.sender, address(this), amount);
        _emitUserRewards(pid, msg.sender);
        poolToUserBalance[pid][msg.sender] += amount;
    }

    function withdraw(uint256 pid, uint256 amount) external override {
        require(amount <= poolToUserBalance[pid][msg.sender]);
        IERC20 pool = _poolInfo[pid].lpToken;
        pool.transfer(msg.sender, amount);
        _emitUserRewards(pid, msg.sender);
        poolToUserBalance[pid][msg.sender] -= amount;
    }

    function emergencyWithdraw(uint256 pid) external override {
        IERC20 pool = _poolInfo[pid].lpToken;

        uint256 amount = poolToUserBalance[pid][msg.sender];
        poolToUserBalance[pid][msg.sender] = 0;

        pool.transfer(msg.sender, amount);
    }

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
        info.allocPoint = 10;
        _poolInfo.push(info);
        totalAllocPoint = totalAllocPoint + info.allocPoint;
    }

    function setAllocPoint(uint256 pid, uint256 allocPoint) external {
        totalAllocPoint = (totalAllocPoint - _poolInfo[pid].allocPoint) + allocPoint;
        _poolInfo[pid].allocPoint = allocPoint;
    }

    function _emitUserRewards(uint256 pid, address user) private {
        uint256 amount = poolToUserRewardsPending[pid][user];
        require(availableRewards >= amount, "LPStakingTime: eTokenBal must be >= _amount");
        availableRewards -= amount;
        stargateMock.mint(user, amount);
        poolToUserRewardsPending[pid][user] = 0;
    }

    function add(uint256, IERC20 lpToken) external override {
        addPool(lpToken);
    }

    function owner() external view override returns (address) {}
}
