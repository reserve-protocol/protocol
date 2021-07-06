// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "@openzeppelin/contracts/access/AccessControlEnumerable.sol";

import "../interfaces/ICircuitBreaker.sol";

contract CircuitBreaker is ICircuitBreaker, AccessControlEnumerable {
    /// ==== Immutable state ====

    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    /// ==== Mutable state ====

    bool private _triggered = false;

    constructor(address _admin) {
        _setupRole(DEFAULT_ADMIN_ROLE, _admin);
        _setupRole(PAUSER_ROLE, _admin);
    }

    modifier isPauser() {
        require(hasRole(PAUSER_ROLE, _msgSender()), "CircuitBreaker: Must be pauser role");
        _;
    }

    function check() public view override returns (bool) {
        return _triggered;
    }

    function pause() external override onlyRole(PAUSER_ROLE) {
        _triggered = true;
        emit Paused(_msgSender());
    }

    function unpause() external override onlyRole(PAUSER_ROLE) {
        _triggered = false;
        emit Unpaused(_msgSender());
    }
}
