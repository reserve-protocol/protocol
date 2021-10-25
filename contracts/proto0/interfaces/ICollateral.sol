// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

interface ICollateral {
    function redemptionRate() external view returns (uint256);

    function erc20() external view returns (address);

    function decimals() external view returns (uint8);

    function fiatcoinDecimals() external view returns (uint8);

    function fiatcoin() external view returns (address);

    function isFiatcoin() external view returns (bool);

    function oracle() external view returns (string memory);
}
