// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

interface IStaderStakePoolManager {
    /**
     * @notice returns the amount of ETH equivalent 1 ETHX (with 18 decimals)
     */
    function getExchangeRate() external view returns (uint256);
}
