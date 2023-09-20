// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

interface IRocketStorage {
    function setUint(bytes32 _key, uint256 _value) external;
}
