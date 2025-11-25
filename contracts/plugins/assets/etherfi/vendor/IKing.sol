// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

// External interface for King token
interface IKing is IERC20Metadata {
    /// @notice Returns the fair value in ETH for a given amount of KING tokens
    /// @param amount The amount of KING tokens
    /// @return The ETH value of the given KING amount
    function fairValueOf(uint256 amount) external view returns (uint256);
}
