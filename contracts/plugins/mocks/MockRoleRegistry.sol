// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

contract MockRoleRegistry {
    function isOwner(address) public pure returns (bool) {
        return true;
    }

    function isEmergencyCouncil(address) public pure returns (bool) {
        return true;
    }

    function isOwnerOrEmergencyCouncil(address) public pure returns (bool) {
        return true;
    }
}
