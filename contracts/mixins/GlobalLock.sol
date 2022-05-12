// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

/**
 * @title GlobalLock
 * @notice Exports the ability to obtain a global lock on main to our Components
 */
abstract contract GlobalLock is Initializable {
    // Storage approach inspired by OZ
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    uint256 private _status;

    // solhint-disable-next-line func-name-mixedcase
    function __GlobalLock_init() internal onlyInitializing {
        _status = _NOT_ENTERED;
    }

    /// Obtain a global lock on the system until `exit` is called
    function _lock() internal {
        require(_status != _ENTERED, "ReentrancyGuard: reentrant call");
        _status = _ENTERED;
    }

    /// Release a global lock on the system
    function _unlock() internal {
        require(_status == _ENTERED, "ReentrancyGuard: missing lock");
        _status = _NOT_ENTERED;
    }
}
