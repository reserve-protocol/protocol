// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/p0/Main.sol";
import "contracts/plugins/mocks/ERC20Mock.sol";

contract MainMock is MainP0 {
    function init(ConstructorArgs calldata) public virtual override(MainP0) {
        require(!initialized, "Already Initialized");
        initialized = true;
        emit Initialized();
    }
}
