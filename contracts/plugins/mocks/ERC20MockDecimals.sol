// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "./ERC20Mock.sol";

contract ERC20MockDecimals is ERC20Mock {
    uint8 private _decimals;

    // solhint-disable-next-line no-empty-blocks
    constructor(
        string memory name,
        string memory symbol,
        uint8 decimals_
    ) ERC20Mock(name, symbol) {
        _decimals = decimals_;
    }

    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }
}
