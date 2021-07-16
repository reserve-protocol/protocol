// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

interface IInsurancePool {

    function balanceOf(address account) external view returns (uint256);

    function earned(address account) external view returns(uint256);

    function lastIndex(address account) external view returns (uint256);

    function totalWeight() external view returns (uint256);

    function weight(address account) external view returns (uint256);

    // ==== Callable only by the RToken ====

    function registerRevenueEvent(uint256 amount) external;

    // ==== Callable by anyone ====

    /// Stake RSR, delayed by a queue
    function stake(uint256 amount) external;

    /// Unstake RSR, delayed by a queue. Caller earns during the withdrawal period.
    function unstake(uint256 amount) external;

    /// Returns all earned RToken. Can call as second half of withdraw process.
    function claimRevenue() external;

    /// Escape hatch for dynamic programming failurecase
    function catchup(address account, uint256 floors) external;

    event DepositInitiated(address indexed user, uint256 amount);
    event DepositCompleted(address indexed user, uint256 amount);
    event WithdrawalInitiated(address indexed user, uint256 amount);
    event WithdrawalCompleted(address indexed user, uint256 amount);
    event RevenueClaimed(address indexed user, uint256 reward);
    event RevenueEventSaved(uint256 index, uint256 amount);
}
