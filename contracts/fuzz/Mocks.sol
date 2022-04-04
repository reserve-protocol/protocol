// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/p0/Main.sol";
import "contracts/p0/mixins/Component.sol";
import "contracts/plugins/mocks/ERC20Mock.sol";

contract MainMock is MainP0 {
    address public sender;
    address[] public USERS = [address(0x10000), address(0x20000), address(0x30000)];

    function setSender(address sender_) public {
        sender = sender_;
    }

    function init(Components memory, IERC20) public virtual override(MainP0) initializer {
        __Pausable_init();
        emit Initialized();
    }

    event TestError(string message);

    function echidna_mainmock_sender_is_always_zero() external returns (bool) {
        emit TestError("Write your tests so that sender is 0 at the end of each transaction.");
        return sender == address(0);
    }
}

abstract contract ComponentMock is Component {
    address[] public USERS = [address(0x10000), address(0x20000), address(0x30000)];

    function _msgSender() internal view virtual override returns (address) {
        return MainMock(address(main)).sender();
    }
}
