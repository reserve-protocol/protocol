// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "../interfaces/ICircuitBreaker.sol";
import "../external/zeppelin/access/AccessControlEnumerable.sol";

contract CircuitBreaker is ICircuitBreaker, AccessControlEnumerable {

    /// ==== Immutable state ====

    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    /// ==== Mutable state ====

    bool public triggered = false;

    constructor (address _admin) {
        grantRole(DEFAULT_ADMIN_ROLE, _admin);
        grantRole(PAUSER_ROLE, _admin);
    }

    modifier isPauser() {
        require(hasRole(PAUSER_ROLE, _msgSender()), "must be pauser role");
        _;
    }

    function check() public view override returns (bool) {
        return triggered;
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        triggered = true;
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        triggered = false;
    }
}
