// SPDX-License-Identifier: MIT
pragma solidity 0.8.9;

interface IPriceProvider {
    function price(address asset_) external view returns (uint256);

    function decimals() external view returns (uint8);
}
