// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

/**
 * @title An interface representing a contract that calculates transaction fees
 */
interface ITXFee {
    function calculateFee(
        address from,
        address to,
        uint256 amount
    ) external view returns (uint256);
}
