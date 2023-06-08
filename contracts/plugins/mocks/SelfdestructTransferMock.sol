// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

contract SelfdestructTransfer {
    function destroyAndTransfer(address payable to) external payable {
        selfdestruct(to);
    }
}
