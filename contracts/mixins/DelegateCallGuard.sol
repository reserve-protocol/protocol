// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

error InvalidCall();

/**
 * @title DelegateCallGuard
 * @notice A mix-in with a modifier to prevent delegatecalls to functions.
 */
abstract contract DelegateCallGuard {
    address public immutable self;

    constructor() {
        self = address(this);
    }

    function _revertOnDelegateCall() internal view {
        if (self != address(this)) revert InvalidCall();
    }

    modifier nonDelegateCall() {
        _revertOnDelegateCall();
        _;
    }
}
