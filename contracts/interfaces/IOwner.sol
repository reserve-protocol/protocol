pragma solidity 0.8.4;

interface Owner {
    function updatePrices(uint256[] calldata prices) external;
    function takeSnapshot() external;

}
