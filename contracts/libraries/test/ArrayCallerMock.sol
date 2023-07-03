// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity ^0.8.19;

import "../Array.sol";

// Simple mock for the Array library.
contract ArrayCallerMock {
    function allUnique(IERC20[] memory arr) public pure returns (bool) {
        return ArrayLib.allUnique(arr);
    }

    function sortedAndAllUnique(IERC20[] memory arr) public pure returns (bool) {
        return ArrayLib.sortedAndAllUnique(arr);
    }
}
