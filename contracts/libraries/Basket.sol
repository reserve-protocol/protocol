// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;


struct CollateralToken {
    address tokenAddress;
    uint256 quantity;
    uint256 perBlockRateLimit;
}

struct Basket {
    mapping(uint256 => CollateralToken) tokens;
    uint256 size;
}
