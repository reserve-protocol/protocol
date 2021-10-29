// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "./ERC20Mock.sol";

contract USDCMock is ERC20Mock {
    constructor(string memory name, string memory symbol) ERC20Mock(name, symbol) {}

    function decimals() public view override returns (uint8) {
        return 6;
    }
}
