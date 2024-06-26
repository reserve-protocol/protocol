// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

// External interface for apxETH
interface IApxETH is IERC20Metadata {
    function assetsPerShare() external view returns (uint256);

    function setWithdrawalPenalty(uint256 penalty) external;

    function notifyRewardAmount() external;
}
