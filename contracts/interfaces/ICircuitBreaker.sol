// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

interface ICircuitBreaker {
    function check() external view returns (bool);
}
