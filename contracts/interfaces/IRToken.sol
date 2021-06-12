pragma solidity 0.8.4;

interface IRToken is IERC20 {
    event Killed(address killer);

    // RToken-specific functions
    function decimals() external view returns(uint8);
    function mint(address, uint256) external;
    function burnFrom(address, uint256) external;
}
