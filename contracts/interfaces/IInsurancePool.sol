// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

interface IInsurancePool {

    function balanceOf(address account) external returns(uint256);

    function earned(address account) external view returns(uint256);

    function lastFloor(address account) external view returns(uint256);

    function totalSupply() external returns(uint256);


    // ==== Callable only by the RToken ====

    function notifyRevenue(bool isRSR, uint256 amount) external;

    function seizeRSR(uint256 amount) external returns(uint256);

    // ==== Callable by anyone ====

    /// Transfers RSR into the contract and locks it
    function stake(uint256 amount) external;

    /// Begins a withdrawal of RSR. Caller earns during the withdrawal period.
    function initiateWithdrawal(uint256 amount) external;

    // Settles the next withdrawal, if enough time has passed.
    function settleNextWithdrawal() external;

    /// Returns all earned RToken. Can call as second half of withdraw process.
    function claimRevenue() external;

    /// Escape hatch for dynamic programming failurecase
    function climb(address account, uint256 floors) external;

    event Staked(address indexed user, uint256 amount);
    event WithdrawalInitiated(address indexed user, uint256 amount);
    event WithdrawalCompleted(address indexed user, uint256 amount);
    event RevenueClaimed(address indexed user, uint256 reward);
    event RevenueEventSaved(bool isRSR, uint256 index, uint256 amount);
    event RSRSeized(uint256 amount);
}
