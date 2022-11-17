// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;


contract CurveStablePoolMock {
    uint256 virtualPrice;
    constructor ()  {}

    function setVirtualPrice(uint256 virtualPrice_) public {
        virtualPrice = virtualPrice_;
    }

    function get_virtial_price() external view returns(uint256) {
        return virtualPrice;
    } 
}