// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

interface IPot {
    function rho() external returns (uint256);

    function drip() external returns (uint256);

    /// {ray}
    function chi() external view returns (uint256);
}
