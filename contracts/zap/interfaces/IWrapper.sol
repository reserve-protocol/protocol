// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

interface IWrapper {
    function wrap(uint256 _amount) external;

    function unwrap(uint256 _amount) external;
}
