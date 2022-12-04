// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

interface IComptroller {
    function getAllMarkets() external view returns (address[] memory);
}
