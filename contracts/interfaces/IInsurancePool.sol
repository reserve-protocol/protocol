// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

interface IInsurancePool {
    function balanceOf(address account) external returns (uint256);

    function earned(address account) external view returns(uint256);

    function lastIndex(address account) external view returns (uint256);

    function totalStake() external view returns (uint256);

    function stake(address account) external view returns (uint256);

    // ==== Callable only by the RToken ====

    function registerRevenueEvent(uint256 amount) external;

    // ==== Callable by anyone ====

    /// Transfers RSR into the contract and locks it
    function initiateDeposit(uint256 amount) external;

    /// Begins a withdrawal of RSR. Caller earns during the withdrawal period.
    function initiateWithdrawal(uint256 amount) external;

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
    event RSRSeized(uint256 amount);
}
