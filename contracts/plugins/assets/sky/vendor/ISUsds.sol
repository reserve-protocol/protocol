// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

interface ISUsds {
    function vow() external view returns (address);

    function usdsJoin() external view returns (address);

    function usds() external view returns (address);

    function ssr() external view returns (uint256);

    function chi() external view returns (uint192);

    function rho() external view returns (uint64);

    function drip() external returns (uint256);
}
