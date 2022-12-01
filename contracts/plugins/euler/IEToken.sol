// SPDX-License-Identifier: MIT 
pragma solidity 0.8.9;

interface IEToken {
    function decimals() external pure returns (uint8);
    function convertBalanceToUnderlying(uint balance) external view returns (uint);
    function touch() external;
}