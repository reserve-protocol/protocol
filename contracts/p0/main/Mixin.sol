// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity ^0.8.9;

import "contracts/p0/interfaces/IMain.sol";

/// Base class for all Main mixins
contract Mixin {
    bool private _initialized;

    function init(ConstructorArgs calldata args) public virtual {
        require(!_initialized, "already initialized");
        _initialized = true;
    }

    function poke() public virtual {
        require(_initialized, "not initialized");
    }
}
