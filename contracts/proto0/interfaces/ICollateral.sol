// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

interface ICollateral {
    function getRedemptionRate() external view returns (uint256);

    function quantity() external view returns (uint256);

    function erc20() external view returns (address);

    function decimals() external view returns (uint8);

    function getUnderlyingERC20() external view returns (address);

    function isFiatcoin() external view returns (bool);
}
