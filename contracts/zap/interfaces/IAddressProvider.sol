// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

interface IAddressProvider {
    function get_address(uint256 _index) external view returns (address);

    function get_registry() external view returns (address);
}
