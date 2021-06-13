pragma solidity 0.8.4;

import "./interfaces/ICircuitBreaker.sol";
import "./zeppelin/access/AccessControlEnumerable.sol";

contract CircuitBreaker is ICircuitBreaker, AccessControlEnumerable {

    /// ==== Immutable state ====

    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    /// ==== Mutable state ====

    bool public override triggered = false;

    constructor (address _admin) {
        grantRole(DEFAULT_ADMIN_ROLE, _admin);
        grantRole(PAUSER_ROLE, _admin);
    }

    modifier isPauser() {
        require(hasRole(PAUSER_ROLE, _msgSender()), "must be pauser role");
        _;
    }

    function check() public view returns (bool) {
        return triggered;
    }

    function pause() external override onlyRole(PAUSER_ROLE) {
        triggered = true;
    }

    function unpause() external override onlyRole(PAUSER_ROLE) {
        triggered = false;
    }
}
