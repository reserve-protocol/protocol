// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.28;

interface IRocketNetworkBalances {
    function getTotalETHBalance() external view returns (uint256);
}
