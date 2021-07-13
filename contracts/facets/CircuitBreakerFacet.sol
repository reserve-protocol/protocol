// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "@openzeppelin/contracts/access/AccessControlEnumerable.sol";

import "../interfaces/ICircuitBreaker.sol";

contract CircuitBreakerFacet is ICircuitBreaker, AccessControlEnumerable {
    AppStorage internal s;

    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    // constructor(address _admin) {
    //     _setupRole(DEFAULT_ADMIN_ROLE, _admin);
    //     _setupRole(PAUSER_ROLE, _admin);
    // }

    modifier isPauser() {
        require(hasRole(PAUSER_ROLE, _msgSender()), "CircuitBreaker: Must be pauser role");
        _;
    }

    function check() public view override returns (bool) {
        return s.tripped;
    }

    function pause() external override isPauser {
        s.tripped = true;
        emit Paused(_msgSender());
    }

    function unpause() external override isPauser {
        s.tripped = false;
        emit Unpaused(_msgSender());
    }
}
