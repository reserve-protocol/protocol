// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "./ERC20Mock.sol";

contract WOZXMock is ERC20Mock {
    uint256 public assetsPerShare;

    constructor() ERC20Mock("Mock WOZX", "WOZX") {}

    function setAssetsPerShare(uint256 mockValue) external {
        assetsPerShare = mockValue;
    }
}