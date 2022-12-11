// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

/// External Interface for CTokens
// See: https://github.com/compound-finance/compound-protocol/blob/master/contracts/CToken.sol


interface ITFToken {
    function poolValue() external view returns (uint256);

    function totalSupply() external view returns (uint256);

    //function exchangeRateTfUsdc(int8) external returns (uint256);
}