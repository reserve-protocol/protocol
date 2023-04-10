// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

interface IPool {
    function totalLiquidity() external view returns (uint256);
    function totalSupply() external view returns (uint256);
}

