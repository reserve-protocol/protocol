pragma solidity 0.8.4;

interface IInsurancePool {

    function balanceOf(address account) external view returns (uint256);

    function earned(address account) external view returns (uint256);

    function totalSupply() external view returns (uint256);

    function exit() external;

    function claimRevenue() external;

    function stake(uint256 amount) external;

    function unstake(uint256 amount) public;

    function climb(address account, uint256 floors) external;
}
