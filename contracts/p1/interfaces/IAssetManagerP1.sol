// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/p1/libraries/AuctionP1.sol";
import "contracts/libraries/Fixed.sol";
import "./IAssetP1.sol";
import "./IMainP1.sol";
import "./IVaultP1.sol";

/**
 * @title IAssetManagerP1
 * @notice Handles the transfer and trade of assets
 *    - Defines the exchange rate between Vault BUs and RToken supply, via the base factor
 *    - Manages RToken backing via a Vault
 *    - Runs recapitalization and revenue auctions
 */
interface IAssetManagerP1 {
    /// Emitted when the current vault is changed
    /// @param oldVault The address of the old vault
    /// @param newVault The address of the new vault
    event NewVaultSet(address indexed oldVault, address indexed newVault);

    //

    /// Mints `issuance.amount` of RToken to `issuance.minter`
    /// @param issuance The SlowIssuance to finalize by issuing RToken
    function issue(SlowIssuance memory issuance) external;

    /// Redeems `amount` {qTok} to `redeemer`
    /// @param redeemer The account that should receive the collateral
    /// @param amount {qTok} The amount of RToken being redeemed
    function redeem(address redeemer, uint256 amount) external;

    /// Performs any and all auctions in the system
    /// @return A `State` enum representing the current state the system is in.
    function doAuctions() external returns (State);

    /// Collects revenue by expanding RToken supply and claiming COMP/AAVE rewards
    function collectRevenue() external;

    /// Accumulates current metrics into historical metrics
    function accumulate() external;

    /// Attempts to switch vaults to a backup vault that does not contain `defaulting` collateral
    /// @param defaulting The list of collateral that are ineligible to be in the next vault
    function switchVaults(ICollateral[] memory defaulting) external;

    /// @return {qRTok/qBU} The base factor
    function baseFactor() external returns (Fix);

    /// BUs -> RToken
    /// @param {qRTok} amount The quantity of RToken to convert to BUs
    /// @return {qBU} The equivalent amount of BUs at the current base factor
    function toBUs(uint256 amount) external returns (uint256);

    /// BUs -> RToken
    /// @param {qBU} BUs The quantity of BUs to convert to RToken
    /// @return {qRTok} The equivalent amount of RToken at the current base factor
    function fromBUs(uint256 BUs) external returns (uint256);

    /// @return Whether the vault is fully capitalized
    function fullyCapitalized() external view returns (bool);

    /// @return The current vault
    function vault() external view returns (IVaultP1);

    /// @return An array of addresses of the approved fiatcoin collateral used for oracle USD determination
    function approvedFiatcoins() external view returns (ICollateral[] memory);
}
