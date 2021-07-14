// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

interface ICircuitBreaker {
    function paused() external view returns (bool);

    function pause() external;

    function unpause() external;

    // Events
    event Paused(address account);
    event Unpaused(address account);
}
