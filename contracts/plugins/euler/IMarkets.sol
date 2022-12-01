// SPDX-License-Identifier: MIT 
pragma solidity 0.8.9;

// interface for Euler's Markets.sol contract
interface IMarkets {
    function underlyingToEToken(address underlying) external view returns (address);
}