pragma solidity 0.8.9;

interface IEToken {
    function decimals() external view returns(uint);
    function convertBalanceToUnderlying(uint256) external view returns (uint256);
}

interface IEulDistributor {

    function claim(
        address account, 
        address token, 
        uint claimable, 
        bytes32[] calldata proof, 
        address stake) external;

    function eul() external view returns(address);

    function getClaimData() external view returns(uint, bytes32[] memory);

}

interface IWSTETH {
    function stEthPerToken() external view returns(uint);
}