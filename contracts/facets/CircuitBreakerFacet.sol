// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "@openzeppelin/contracts/access/AccessControlEnumerable.sol";

import "../interfaces/ICircuitBreaker.sol";
import "../libraries/Storage.sol";

contract CircuitBreakerFacet is ICircuitBreaker, AccessControlEnumerable {
    using DiamondStorage for DiamondStorage.Info;

    DiamondStorage.Info internal ds;
    
    // How does this work? This dictates something in the second storage slot...
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    struct CircuitBreakerStorage {
        bool paused;
    }



    // constructor(address _admin) {
    //     _setupRole(DEFAULT_ADMIN_ROLE, _admin);
    //     _setupRole(PAUSER_ROLE, _admin);
    // }

    modifier isPauser() {
        require(hasRole(PAUSER_ROLE, _msgSender()), "CircuitBreaker: Must be pauser role");
        _;
    }

    function check() public view override returns (bool) {
        return ds.circuitBreakerStorage().paused;
    }

    function pause() external override isPauser {
        ds.circuitBreakerStorage().paused = true;
        emit Paused(_msgSender());
    }

    function unpause() external override isPauser {
        ds.circuitBreakerStorage().paused = false;
        emit Unpaused(_msgSender());
    }
}
