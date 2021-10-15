// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

interface IStakingPool {
    function stake(uint256 amount) external;

    function unstake(uint256 amount) external;

    function addRSR(uint256 amount) external;

    function seizeRSR(uint256 amount) external;
}
