// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "./ERC20Mock.sol";

contract CurveStablePoolMock is ERC20Mock {
    uint256 virtualPrice;
    constructor (string memory name, string memory symbol) ERC20Mock(name, symbol) {}

    function setVirtualPrice(uint256 virtualPrice_) public {
        virtualPrice = virtualPrice_;
    }

    function get_virtial_price() external view returns(uint256) {
        return virtualPrice;
    } 
}