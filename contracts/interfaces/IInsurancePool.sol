pragma solidity 0.8.4;

interface IInsurancePool {

    function balanceOf(address account) external view returns (uint256);

    function earned(address account) external view returns (uint256);

    function totalSupply() external view returns (uint256);

    // =================================

    /// Callable only by the RToken
    function saveRevenueEvent(uint256 amount) external;
    function seizeRSR(uint256 amount) external;

    // =================================

    /// Transfers RSR into the contract and locks it
    function stake(uint256 amount) external;

    /// Begins a withdrawal of RSR. Caller earns during the withdrawal period.
    function initiateWithdrawal(uint256 amount) public;

    /// Returns all earned RToken. Can call as second half of withdraw process.
    function claimRevenue() external;

    /// Escape hatch for dynamic programming failurecase
    function climb(address account, uint256 floors) external;
}
