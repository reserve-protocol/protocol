// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";

/**
 * @title Lockable
 * @notice Provides affordances for locking to Main, ensuring that the caller
 *   of unlock is always the contract that originally called lock.
 */
abstract contract Lockable is Initializable, ContextUpgradeable {
    // Storage approach inspired by OZ
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    uint256 private _status;

    address private _locker;

    // solhint-disable-next-line func-name-mixedcase
    function __Lockable_init() internal onlyInitializing {
        _status = _NOT_ENTERED;
    }

    /// Obtain a lock on the system until `exit` is called
    function _lock() internal {
        require(_status != _ENTERED, "reentrant call");
        _status = _ENTERED;
        _locker = _msgSender();
    }

    /// Release a lock on the system
    function _unlock() internal {
        require(_locker == _msgSender(), "unlocker is different contract");
        require(_status == _ENTERED, "no lock present");
        _status = _NOT_ENTERED;
        // no need to unset _locker
    }
}
