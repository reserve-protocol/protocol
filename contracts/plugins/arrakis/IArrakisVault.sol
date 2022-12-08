// SPDX-License-Identifier: MIT 
pragma solidity 0.8.9;

interface IArrakisVault { 
    function getUnderlyingBalances() external view returns (
      uint256 amount0Current, 
      uint256 amount1Current
    );
    function totalSupply() external view returns (uint256);

}