// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "./IAsset.sol";
import "./IVault.sol";

/**
 * @title IDefaultMonitor
 * @notice Provides the logic to check for collateral default.
 */
interface IDefaultMonitor {
    /// Checks for hard default in a vault by inspecting the redemption rates of collateral tokens
    /// @param vault The vault to inspect
    function checkForHardDefault(IVault vault) external returns (IAsset[] memory);

    /// Checks for soft default in a vault by checking oracle values for all fiatcoins in the vault
    /// @param vault The vault to inspect
    /// @param fiatcoins An array of addresses of fiatcoin assets to use for median USD calculation
    function checkForSoftDefault(IVault vault, IAsset[] memory fiatcoins) external view returns (IAsset[] memory);

    /// Returns a vault from the list of backup vaults that is not defaulting
    /// @param vault The vault that is currently defaulting
    /// @param approvedCollateral An array of addresses of all collateral assets eligible to be in the new vault
    /// @param fiatcoins An array of addresses of fiatcoin assets to use for median USD calculation
    function getNextVault(
        IVault vault,
        address[] memory approvedCollateral,
        address[] memory fiatcoins
    ) external returns (IVault);
}
