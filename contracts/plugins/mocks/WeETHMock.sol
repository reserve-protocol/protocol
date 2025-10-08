// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "./ERC20Mock.sol";

contract WeEthMock is ERC20Mock {
    uint256 private _rate;

    constructor() ERC20Mock("Mock WeETH", "WeEth") {}

    // Mock function for testing
    function setRate(uint256 mockRate) external {
        _rate = mockRate;
    }

    function getRate() external view returns (uint256) {
        return _rate;
    }
}
