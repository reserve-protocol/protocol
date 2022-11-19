// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "./ERC20Mock.sol";

contract NTokenERC20ProxyMock is ERC20Mock {

    int256 value;

    constructor(
        string memory name,
        string memory symbol
    ) ERC20Mock(name, symbol) {
        value = 0;
    }

    function setUnderlyingValue(int256 _value) external {
        value = _value;
    }

    function getPresentValueUnderlyingDenominated() external view returns (int256) {
        return value;
    }

    function decimals() public view override returns (uint8) {
        return 8;
    }
}
