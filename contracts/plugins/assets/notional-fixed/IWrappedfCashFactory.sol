// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

interface IWrappedfCashFactory {
    function deployWrapper(uint16 currencyId, uint40 maturity) external returns (address);

    function computeAddress(uint16 currencyId, uint40 maturity) external view returns (address);
}