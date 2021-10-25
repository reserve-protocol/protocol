// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

interface IFaucet {
    function handout(uint256 amount, uint256 timePeriod) external;

    function drip() external;
}
