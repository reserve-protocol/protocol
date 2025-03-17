// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

contract MockMidasAccessControl {
    mapping(bytes32 => mapping(address => bool)) private _roles;

    function setRole(
        bytes32 role,
        address account,
        bool hasRole
    ) external {
        _roles[role][account] = hasRole;
    }

    function hasRole(bytes32 role, address account) external view returns (bool) {
        return _roles[role][account];
    }
}
