// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

// solhint-disable-next-line max-line-length
import { AccessControlEnumerable } from "@openzeppelin/contracts/access/AccessControlEnumerable.sol";

/**
 * @title RoleRegistry
 * @notice Contract to manage roles for RToken <> DAO interactions
 */
contract RoleRegistry is AccessControlEnumerable {
    bytes32 public constant EMERGENCY_COUNCIL = keccak256("EMERGENCY_COUNCIL");

    constructor() {
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    function isOwner(address account) public view returns (bool) {
        return hasRole(DEFAULT_ADMIN_ROLE, account);
    }

    function isEmergencyCouncil(address account) public view returns (bool) {
        return hasRole(EMERGENCY_COUNCIL, account);
    }

    function isOwnerOrEmergencyCouncil(address account) public view returns (bool) {
        return hasRole(DEFAULT_ADMIN_ROLE, account) || hasRole(EMERGENCY_COUNCIL, account);
    }
}
