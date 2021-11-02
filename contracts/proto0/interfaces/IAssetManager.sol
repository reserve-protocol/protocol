// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "../libraries/Auction.sol";
import "./IAsset.sol";
import "./IMain.sol";
import "./IVault.sol";

/**
 * @title IAssetManager
 * @notice Handles the transfer and trade of assets
 *    - Defines the exchange rate between Vault BUs and RToken supply, via the base factor
 *    - Manages RToken backing via a Vault
 *    - Runs recapitalization and revenue auctions
 */
interface IAssetManager {
    /// @notice Emitted when an auction is started
    /// @param auctionId The index of the auction, a globally unique identifier
    /// @param sell The token to sell
    /// @param buy The token to buy
    /// @param sellAmount The quantity of the selling token
    /// @param minBuyAmount The minimum quantity of the buying token to accept
    /// @param fate The fate of the soon-to-be-purchased tokens
    event AuctionStart(
        uint256 indexed auctionId,
        address indexed sell,
        address indexed buy,
        uint256 sellAmount,
        uint256 minBuyAmount,
        Fate fate
    );

    /// @notice Emitted after an auction ends
    /// @param auctionId The index of the auction, a globally unique identifier
    /// @param sellAmount The quantity of the token sold
    /// @param buyAmount The quantity of the token bought
    event AuctionEnd(uint256 indexed auctionId, uint256 sellAmount, uint256 buyAmount);

    /// @notice Emitted when the current vault is changed
    /// @param oldVault The address of the old vault
    /// @param newVault The address of the new vault
    event NewVault(address indexed oldVault, address indexed newVault);

    //

    /// @notice Runs block-by-block updates
    function updateBaseFactor() external; // block-by-block idempotent updates

    /// @notice Mints `issuance.amount` of RToken to `issuance.minter`
    /// @param issuance The SlowIssuance to finalize by issuing RToken
    function issue(SlowIssuance memory issuance) external;

    /// @notice Redeems `amount` {qRToken} to `redeemer`
    /// @param redeemer The account that should receive the collateral
    /// @param amount The amount of RToken being redeemed {qRToken}
    function redeem(address redeemer, uint256 amount) external;

    /// @notice Performs any and all auctions in the system
    /// @return The current enum `State`
    function doAuctions() external returns (State);

    /// @notice Collects revenue by expanding RToken supply and claiming COMP/AAVE rewards
    function collectRevenue() external;

    /// @notice Accumulates current metrics into historical metrics
    function accumulate() external;

    /// @notice Attempts to switch vaults to a backup vault that does not contain `defaulting` assets
    /// @param defaulting The list of assets that are ineligible to be in the next vault
    function switchVaults(IAsset[] memory defaulting) external;

    /// @notice RToken -> BUs
    /// @param amount The quantity of RToken {qRToken} to convert to BUs
    /// @return The equivalent amount of BUs at the current base factor
    function toBUs(uint256 amount) external view returns (uint256);

    /// @notice BUs -> RToken
    /// @param BUs The quantity of BUs {qBUs} to convert to RToken
    /// @return The equivalent amount of RToken at the current base factor
    function fromBUs(uint256 BUs) external view returns (uint256);

    /// @return Whether the vault is fully capitalized
    function fullyCapitalized() external view returns (bool);

    /// @return The current vault
    function vault() external view returns (IVault);

    /// @return An array of addresses of the approved fiatcoin assets used for oracle USD determination
    function approvedFiatcoins() external view returns (IAsset[] memory);
}
