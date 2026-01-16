// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.28;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

// External interface for King token
interface IKing is IERC20Metadata {
    /// @notice Returns the fair value in ETH and USD for an amount of KING tokens
    /// @param vaultTokenShares The amount of KING tokens
    /// @return ethValue The ETH value of the given KING amount
    /// @return usdValue The USD value of the given KING amount
    function fairValueOf(uint256 vaultTokenShares)
        external
        view
        returns (uint256 ethValue, uint256 usdValue);
}
