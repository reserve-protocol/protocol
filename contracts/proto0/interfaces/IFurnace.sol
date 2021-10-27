// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

interface IFurnace {
    function burnOverPeriod(uint256 amount, uint256 timePeriod) external;

    function doBurn() external;

    function totalBurnt() external view returns (uint256);
}
