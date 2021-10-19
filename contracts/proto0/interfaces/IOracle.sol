// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

interface IOracle {
    function setPrice(address token, uint256 amount) external;

    function getPrice(address token) external view returns (uint256);
}
