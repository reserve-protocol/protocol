// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/p1/interfaces/IAssetP1.sol";
import "contracts/p1/interfaces/IMainP1.sol";
import "contracts/libraries/Fixed.sol";

/// @param collateral Mapping from an incremental index to asset
/// @param quantities {qTok/BU}
/// @param size The number of collateral in the basket
struct Basket {
    mapping(uint256 => ICollateral) collateral; // index -> asset
    mapping(ICollateral => uint256) quantities; // {qTok/BU}
    uint256 size;
}

/*
 * @title IVaultP1
 * @notice An issuer of an internal bookkeeping unit called a BU or basket unit.
 */
interface IVaultP1 {
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
    /// Emitted whenever rewards are claimed
    /// @param compAmount {qCOMP} The amount of COMP claimed
    /// @param aaveAmount {qAAVE} The amount of COMP claimed
    event RewardsClaimed(uint256 indexed compAmount, uint256 indexed aaveAmount);

    //

    /// Transfers collateral in and issues a quantity of BUs to the caller
    /// @param to The account to transfer collateral to
    /// @param amtBUs {qBU} The quantity of BUs to issue
    function issue(address to, uint256 amtBUs) external;

    /// Redeems a quantity of BUs and transfers collateral out
    /// @param to The account to transfer collateral to
    /// @param amtBUs {qBU} The quantity of BUs to redeem
    function redeem(address to, uint256 amtBUs) external;

    /// Allows `spender` to spend `amtBUs` from the callers account
    /// @param spender The account that is able to spend the `amtBUs`
    /// @param amtBUs {qBU} The quantity of BUs that should be spendable
    function setAllowance(address spender, uint256 amtBUs) external;

    /// Pulls BUs over from one account to another (like `ERC20.transferFrom`), requiring allowance
    /// @param from The account to pull BUs from (must have set allowance)
    /// @param amtBUs {qBU} The quantity of BUs to pull
    function pullBUs(address from, uint256 amtBUs) external;

    /// Claims all earned COMP/AAVE and sends it to the asset manager
    function claimAndSweepRewardsToManager() external;

    /// @return {USD/qBU} The USD value of 1 BU if all fiatcoins hold peg
    function basketRate() external returns (Fix);

    /// @return {qTok} A list of token quantities required in order to issue `amtBUs`, in the order of the basket.
    function tokenAmounts(uint256 amtBUs) external view returns (uint256[] memory);

    /// @return Whether the vault is made up only of collateral in `collateral`
    function containsOnly(address[] memory collateral) external view returns (bool);

    /// @return {qBU} The maximum number of BUs the caller can issue
    function maxIssuable(address issuer) external view returns (uint256);

    /// @return The collateral asset at `index`
    function collateralAt(uint256 index) external view returns (ICollateral);

    /// @return The size of the basket
    function size() external view returns (uint256);

    /// @return The number of basket units `account` has
    function basketUnits(address account) external view returns (uint256);

    /// @return {qTok/BU} The quantity of tokens of `asset` required per whole BU
    function quantity(ICollateral asset) external view returns (uint256);

    /// @return A list of eligible backup vaults
    function getBackups() external view returns (IVaultP1[] memory);

    /// @return The number of decimals in a BU
    // solhint-disable-next-line func-name-mixedcase  (underlyingly a constant state var; all-caps makes sense)
    function BU_DECIMALS() external view returns (uint8);
}
