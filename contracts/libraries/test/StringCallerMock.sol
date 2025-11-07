// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity ^0.8.28;

import "../String.sol";

// Simple mock for String library.
// prettier-ignore
contract StringCallerMock {
    function toLower(string memory str) external pure returns (string memory){
        return StringLib.toLower(str);
    }

}
