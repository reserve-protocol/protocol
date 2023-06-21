// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "../assets/dsr/SDaiCollateral.sol";

contract PotMock is IPot {
    IPot public immutable pot;

    uint256 public chi; // {ray}

    constructor(IPot _pot) {
        pot = _pot;
        chi = pot.chi();
    }

    function setChi(uint256 newChi) external {
        chi = newChi;
    }

    function drip() external returns (uint256) {
        return pot.drip();
    }

    function rho() external returns (uint256) {
        return pot.rho();
    }
}
