// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "./IStargateLPStaking.sol";
import "./IStargatePool.sol";

interface IStargatePoolWrapper is IERC20Metadata {
    error InvalidPool(address pool);
    error ZeroAddress();
    error EmptyString();

    event Deposit(address indexed from, uint256 amount);
    event Withdraw(address indexed to, uint256 amount);

    function stakingContract() external view returns (IStargateLPStaking);

    function poolId() external view returns (uint256);

    function pool() external view returns (IStargatePool);

    function poolDecimals() external view returns (uint8);

    function stargate() external view returns (IERC20);

    function stgPerShare() external view returns (uint256);

    function userCollected(address) external view returns (uint256);

    function userOwed(address) external view returns (uint256);

    function deposit(uint256 _amount) external;

    function withdraw(uint256 _amount) external;

    // function exchangeRate() external view returns (uint192 rate);

    function totalLiquidity() external view returns (uint256);
}
