// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IStakingPool is IERC20 {
    function stake(uint256 amount) external;

    function unstake(uint256 amount) external;

    function addRSR(uint256 amount) external;

    function seizeRSR(uint256 amount) external;
}
