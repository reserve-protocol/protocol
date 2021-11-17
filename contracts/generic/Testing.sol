// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "hardhat/console.sol";

library Testing {
    /// uint version
    /// @param str A human-readable prefix to accompany the error message
    /// @return Returns whether the uints match or not
    function eq(
        uint256 a,
        uint256 b,
        string memory str
    ) internal view returns (bool) {
        if (a != b) {
            console.log(string(abi.encodePacked(str, " | %s != %s")), a, b);
            return false;
        }
        return true;
    }

    /// str version
    /// @param str A human-readable prefix to accompany the error message
    /// @return Returns whether the strings match or not
    function eq(
        string memory a,
        string memory b,
        string memory str
    ) internal view returns (bool) {
        if (keccak256(bytes(a)) != keccak256(bytes(b))) {
            console.log(string(abi.encodePacked(str, " | %s != %s")), a, b);
            return false;
        }
        return true;
    }
}
