// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/p0/assets/ATokenCollateral.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/interfaces/IRewardsClaimer.sol";
import "contracts/libraries/Fixed.sol";

/// @param collateral Mapping from an incremental index to asset
/// @param quantities {qTok/BU}
/// @param size The number of collateral in the basket
struct Basket {
    mapping(uint256 => ICollateral) collateral; // index -> asset
    mapping(IAsset => uint256) quantities; // {qTok/BU}
    uint256 size;
}

/*
 * @title IVault
 * @notice An issuer of an internal bookkeeping unit called a BU or basket unit.
 */
interface IVault is IRewardsClaimer {
    /// Emitted whenever new BUs are issued
    /// @param to The account that earned the BUs
    /// @param by The account that paid for the BUs
    /// @param amtBUs {qBU} The quantity of BUs issued
    event BUsIssued(address indexed to, address indexed by, uint256 indexed amtBUs);
    /// Emitted whenever BUs are redeemed
    /// @param to The account that received the resulting collateral
    /// @param by The account whose BUs are redeemed
    /// @param amtBUs {qBU} The quantity of BUs redeemed
    event BUsRedeemed(address indexed to, address indexed by, uint256 indexed amtBUs);
    /// Emitted whenever BUs are transferred
    /// @param from The account that sent the BUs
    /// @param to The account that received for the BUs
    /// @param amtBUs {qBU} The quantity of BUs transferred
    event BUsTransferred(address indexed from, address indexed to, uint256 indexed amtBUs);

    //

    /// Transfers collateral in and issues a quantity of BUs to the caller
    /// @param to The account to transfer collateral to
    /// @param amtBUs {qBU} The quantity of BUs to issue
    function issue(address to, uint256 amtBUs) external;

    /// Redeems a quantity of BUs and transfers collateral out
    /// @param to The account to transfer collateral to
    /// @param amtBUs {qBU} The quantity of BUs to redeem
    function redeem(address to, uint256 amtBUs) external;

    /// Transfers a quantity of BUs to an address from msg.sender's account, like in ERC20
    /// @param to The account to send BUs to
    function transfer(address to, uint256 amtBUs) external;

    /// Main Setter
    function setMain(IMain main) external;

    /// @return {Price/BU} The Price of 1 whole BU
    function basketPrice() external view returns (Price memory);

    /// @return {qTok} A list of token quantities required in order to issue `amtBUs`, in the order of the basket.
    function quote(uint256 amtBUs, RoundingApproach rounding)
        external
        view
        returns (uint256[] memory);

    /// @return Whether the vault is made up only of collateral in `collateral`
    function containsOnly(ICollateral[] memory collateral) external view returns (bool);

    /// @return {qBU} The maximum number of BUs the caller can issue
    function maxIssuable(address issuer) external view returns (uint256);

    /// @return The collateral asset at `index`
    function collateralAt(uint256 index) external view returns (ICollateral);

    /// @return The size of the basket
    function size() external view returns (uint256);

    /// @return The number of basket units `account` has
    function basketUnits(address account) external view returns (uint256);

    /// @return {qTok/BU} The quantity of qTokens of `asset` required per whole BU
    function quantity(IAsset asset) external view returns (uint256);

    /// @return A list of eligible backup vaults
    function getBackups() external view returns (IVault[] memory);

    /// @return The maximum CollateralStatus among vault collateral
    function worstCollateralStatus() external view returns (CollateralStatus);

    /// @return The number of decimals in a BU
    // solhint-disable-next-line func-name-mixedcase
    function BU_DECIMALS() external view returns (uint8);
}
