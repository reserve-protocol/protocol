// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

struct Token {
    address tokenAddress;
    uint256 quantity; // Quantity required for each basket unit
}

struct Basket {
    mapping(uint16 => Token) tokens;
    uint16 size;
}

interface IVault {
    function issue(uint256 amount) external;

    function redeem(uint256 amount) external;

    function tokenAmounts(uint256 amount) external view returns (uint256[] memory);

    function basketSize() external view returns (uint16);

    function tokenAt(uint16 index) external view returns (Token memory);
}
