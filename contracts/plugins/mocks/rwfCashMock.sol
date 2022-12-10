// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "./ERC20Mock.sol";
import "../assets/notional-fixed/IReservefCashWrapper.sol";

contract rwfCashMock is ERC20Mock, IReservefCashWrapper {

    uint256 private _refPerTok;

    constructor(
        string memory name,
        string memory symbol
    ) ERC20Mock(name, symbol) {}

    function setRefPerTok(uint256 value) external {
        _refPerTok = value;
    }

    function refPerTok() external view returns (uint256) {
        return _refPerTok;
    }

    function reinvest() external {}
}