// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "hardhat/console.sol";

interface IContextMixin {
    function connect(address account) external;
}

/**
 * @dev Provides information about the current execution context, including the
 * sender of the transaction and its data. While these are generally available
 * via msg.sender and msg.data, they should not be accessed in such a direct
 * manner, since when dealing with meta-transactions the account sending and
 * paying for execution may not be the actual sender (as far as an application
 * is concerned).
 *
 * This contract is only required in order to leverage our generic testing harness,
 * which needs to replace msg.sender.
 *
 * @dev A mix-in that enables mocking out msg.sender via multiple inheritance.
 */
abstract contract ContextMixin is IContextMixin {
    address internal _msgDotSender;
    address internal _admin;

    constructor(address admin) {
        _admin = admin;
    }

    function connect(address account) external override {
        require(msg.sender == _admin, "admin only");
        _msgDotSender = account;
    }

    function _mixinMsgSender() internal view virtual returns (address) {
        // console.log("_mixinMsgSender()");
        if (msg.sender == _admin) {
            // console.log("caller is deployer");
            assert(_msgDotSender != address(0)); // this indicates a bug in the way the contract is used
            return _msgDotSender;
        }
        return msg.sender;
    }
}
