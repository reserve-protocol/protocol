// SPDX-License-Identifier: SEE LICENSE IN LICENSE
pragma solidity ^0.8.9;

import "./PriceProviderMock.sol";

contract InvalidPriceProviderMock is PriceProviderMock {
    bool public simplyRevert;

    constructor() PriceProviderMock() {}

    function price(address) external view override returns (uint256) {
        if (simplyRevert) {
            revert(); // Revert with no reason
        } else {
            // Run out of gas
            this.infiniteLoop{ gas: 10 }();
        }
        return 10**FIX_DECIMALS;
    }

    function setSimplyRevert(bool on) external {
        simplyRevert = on;
    }

    function infiniteLoop() external pure {
        uint256 i = 0;
        uint256[1] memory array;
        while (true) {
            array[0] = i;
            i++;
        }
    }
}