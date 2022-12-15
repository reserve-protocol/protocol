// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/interfaces/IMarket.sol";

import "./AbstractMulticall.sol";

abstract contract AbstractMarket is AbstractMulticall, IMarket {
    function _getBalance(IERC20 token) internal view returns (uint256) {
        if (address(token) == address(0)) {
            return address(this).balance;
        } else {
            return token.balanceOf(address(this));
        }
    }
}
