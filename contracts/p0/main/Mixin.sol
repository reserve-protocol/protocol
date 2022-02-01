// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity ^0.8.9;

import "contracts/p0/interfaces/IMain.sol";

/// Base class for all Main mixins
abstract contract Mixin is IMixin {
    bool private _initialized;

    function init(ConstructorArgs calldata) public virtual {
        require(!_initialized, "already initialized");
        _initialized = true;
        emit Initialized();
    }

    function poke() public virtual {
        require(_initialized, "not initialized");
        emit Poked();
    }
}
