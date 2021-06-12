pragma solidity 0.8.4;

/**
 * @title An interface representing a contract that calculates transaction fees
 */
interface ITXFee {
    function calculateFee(address from, address to, uint256 amount) external returns (uint256);
}
