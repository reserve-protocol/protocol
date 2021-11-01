// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

import "../interfaces/IAsset.sol";
import "../interfaces/IMain.sol";

/// @param assets Mapping from an incremental index to asset
/// @param quantities Mapping from asset to quantity of asset that is in one BU (1e18)
/// @param size The number of assets in the basket
struct Basket {
    mapping(uint256 => IAsset) assets;
    mapping(IAsset => uint256) quantities;
    uint256 size;
}

/*
 * @title VaultP0
 * @notice An issuer of an internal bookkeeping unit called a BU or basket unit.
 */
interface IVault {
    /// @notice Emitted whenever new BUs are issued
    /// @param to The account that earned the BUs
    /// @param by The account that paid for the BUs
    /// @param amount The quantity of BUs issued
    event BUIssuance(address indexed to, address indexed by, uint256 indexed amount);
    /// @notice Emitted whenever BUs are redeemed
    /// @param to The account that received the resulting collateral
    /// @param by The account whose BUs are redeemed
    /// @param amount The quantity of BUs redeemed
    event BURedemption(address indexed to, address indexed by, uint256 indexed amount);
    /// @notice Emitted whenever BUs are transferred
    /// @param from The account that sent the BUs
    /// @param to The account that received for the BUs
    /// @param amount The quantity of BUs transferred
    event BUTransfer(address indexed from, address indexed to, uint256 indexed amount);
    /// @notice Emitted whenever rewards are claimed
    /// @param compAmount The amount of COMP claimed
    /// @param aaveAmount The amount of COMP claimed
    event ClaimRewards(uint256 indexed compAmount, uint256 indexed aaveAmount);

    //

    /// @notice Transfers collateral in and issues a quantity of BUs to the caller
    /// @param to The account to transfer collateral to
    /// @param amount The quantity of BUs to issue
    function issue(address to, uint256 amount) external;

    /// @notice Redeems a quantity of BUs and transfers collateral out
    /// @param to The account to transfer collateral to
    /// @param amount The quantity of BUs to redeem
    function redeem(address to, uint256 amount) external;

    /// @notice Allows `spender` to spend `amount` from the callers account
    /// @param spender The account that is able to spend the `amount`
    /// @param amount The quantity of BUs that should be spendable
    function setAllowance(address spender, uint256 amount) external;

    /// @notice Pulls BUs over from one account to another (like `ERC20.transferFrom`), requiring allowance
    /// @param from The account to pull BUs from (must have set allowance)
    /// @param amount The quantity of BUs to pull
    function pullBUs(address from, uint256 amount) external;

    /// @notice Claims all earned COMP/AAVE and sends it to the asset manager
    function claimAndSweepRewardsToManager() external;

    /// @notice Forces an update of rates in the Compound/Aave protocols, call before `basketRate()` for recent rates
    function updateCompoundAaveRates() external;

    /// @return A list of token quantities required in order to issue `amount` BUs
    function tokenAmounts(uint256 amount) external view returns (uint256[] memory);

    /// @return The combined fiatcoin worth of one BU
    function basketRate() external view returns (uint256);

    /// @return Whether the vault is made up only of collateral in `assets`
    function containsOnly(address[] memory assets) external view returns (bool);

    /// @return The maximum number of BUs the caller can issue
    function maxIssuable(address issuer) external view returns (uint256);

    /// @return The asset at `index`
    function assetAt(uint256 index) external view returns (IAsset);

    /// @return The size of the basket
    function size() external view returns (uint256);

    /// @return The number of basket units `account` has
    function basketUnits(address account) external view returns (uint256);

    /// @return The quantity of tokens of `asset` required to create 1e18 BUs
    function quantity(IAsset asset) external view returns (uint256);

    /// @return A list of eligible backup vaults
    function getBackups() external view returns (IVault[] memory);
}
