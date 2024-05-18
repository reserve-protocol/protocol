pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

interface ISLR is IERC20Metadata {
    function convertToAssets(uint256 shares) external view returns (uint256);

    function pricePerShare() external view returns (uint256);

    function rewardsCycleEnd() external view returns (uint32);

    function syncRewards() external;
}
