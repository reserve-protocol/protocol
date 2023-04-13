// SPDX-License-Identifier: MIT
pragma solidity >0.7.0 <0.9.0;

import "./IVault.sol";

interface BPool {
    function totalSupply() external view returns (uint);
    function getVirtualSupply() external view returns (uint);
    function balanceOf(address whom) external view returns (uint);
    function allowance(address src, address dst) external view returns (uint);

    function approve(address dst, uint amt) external returns (bool);
    function transfer(address dst, uint amt) external returns (bool);
    function decimals() external view returns (uint8);

    function getVault() external view returns (IVault);
}