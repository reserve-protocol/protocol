// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "./ERC20Mock.sol";

contract BRKLMock is ERC20Mock {
    uint256 public assetsPerShare;

    constructor() ERC20Mock("Mock BRKL", "BRKL") {}

    function setAssetsPerShare(uint256 mockValue) external {
        assetsPerShare = mockValue;
    }
}