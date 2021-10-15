// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "@openzeppelin/contracts/access/AccessControlEnumerable.sol";

import "../interfaces/ICircuitBreaker.sol";

/**
 * @title CircuitBreaker
 * @dev A lightweight contract that holds a paused state and maintains a list of pausers.
 *
 * Uses the AccessControl pattern.
 */

contract CircuitBreaker is ICircuitBreaker, AccessControlEnumerable {
    // ==== Immutable ====
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    // ==== Mutable ====
    bool private _paused = false;

    constructor(address _admin) {
        _setupRole(DEFAULT_ADMIN_ROLE, _admin);
        _setupRole(PAUSER_ROLE, _admin);
    }

    // =========================== Pausing =================================

    modifier isPauser() {
        require(hasRole(PAUSER_ROLE, _msgSender()), "CircuitPaused");
        _;
    }

    function paused() public view override returns (bool) {
        return _paused;
    }

    function pause() external override isPauser {
        _paused = true;
        emit Paused(_msgSender());
    }

    function unpause() external override isPauser {
        _paused = false;
        emit Unpaused(_msgSender());
    }
}
