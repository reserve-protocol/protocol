// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.6.12;

contract Temp {
    function encodeOrder(
        uint64 userId,
        uint96 buyAmount,
        uint96 sellAmount
    ) external pure returns (bytes32) {
        return bytes32((uint256(userId) << 192) + (uint256(buyAmount) << 96) + uint256(sellAmount));
    }
}
