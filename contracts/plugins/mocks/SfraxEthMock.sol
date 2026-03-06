// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.28;

import "./ERC20Mock.sol";

contract SfraxEthMock is ERC20Mock {
    uint256 public pricePerShare;

    constructor() ERC20Mock("Mock SfrxETH", "SfrxEth") {}

    function setPricePerShare(uint256 mockValue) external {
        pricePerShare = mockValue;
    }
}
