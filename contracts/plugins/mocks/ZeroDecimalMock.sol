// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "./ERC20Mock.sol";

contract ZeroDecimalMock is ERC20Mock {
    // solhint-disable-next-line no-empty-blocks
    constructor(string memory name, string memory symbol) ERC20Mock(name, symbol) {}

    function decimals() public pure override returns (uint8) {
        return 0;
    }
}
