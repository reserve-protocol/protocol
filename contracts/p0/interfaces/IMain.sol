// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/p0/libraries/Oracle.sol";
import "contracts/IMain.sol";
import "./IAsset.sol";
import "./IAssetManager.sol";
import "./IDefaultMonitor.sol";
import "./IFurnace.sol";
import "./IRToken.sol";
import "./IStRSR.sol";
import "./IVault.sol";

/// Tracks data for an issuance
/// @param vault The vault the issuance is against
/// @param amount {qTok} The quantity of RToken the issuance is for
/// @param BUs {qBU} The number of BUs that corresponded to `amount` at time of issuance
/// @param deposits {qTok} The collateral token quantities that were used to pay for the issuance
/// @param issuer The account issuing RToken
/// @param blockAvailableAt {blockNumber} The block number at which the issuance can complete
/// @param processed false when the issuance is still vesting
struct SlowIssuance {
    IVault vault;
    uint256 amount; // {qTok}
    uint256 BUs; // {qBU}
    uint256[] deposits; // {qTok}, same index as vault basket assets
    address issuer;
    uint256 blockAvailableAt; // {blockNumber}
    bool processed;
}

/**
 * @title IMain
 * @notice The central coordinator for the entire system, as well as the external interface.
 * @dev The p0-specific IMain
 */
interface IMain is IMainCommon {
    /// @return The RSR ERC20 deployment on this chain
    function rsr() external view returns (IERC20);

    /// @return The RToken provided by the system
    function rToken() external view returns (IRToken);

    /// @return The RToken Furnace associated with this RToken instance
    function furnace() external view returns (IFurnace);

    /// @return The staked form of RSR for this RToken instance
    function stRSR() external view returns (IStRSR);

    /// @return The AssetManager associated with this RToken instance
    function manager() external view returns (IAssetManager);

    /// @return The DefaultMonitor associated with this RToken instance
    function monitor() external view returns (IDefaultMonitor);

    /// @return {attoUSD/qTok} The price in attoUSD of `token` on oracle `source`.
    function consultOracle(Oracle.Source source, address token) external view returns (Fix);

    /// @return The deployment of the comptroller on this chain
    function comptroller() external view returns (IComptroller);

    /// @return The deployment of the aave lending pool on this chain
    function aaveLendingPool() external view returns (IAaveLendingPool);

    /// @return The asset for the RToken
    function rTokenAsset() external view returns (IAsset);

    /// @return The asset for RSR
    function rsrAsset() external view returns (IAsset);

    /// @return The asset for COMP
    function compAsset() external view returns (IAsset);

    /// @return The asset for AAVE
    function aaveAsset() external view returns (IAsset);

    // Setters

    function setManager(IAssetManager manager_) external;

    function setMonitor(IDefaultMonitor monitor_) external;

    function setRToken(IRToken rToken_) external;

    function setConfig(Config memory config_) external;

    function setPauser(address pauser_) external;

    function setStRSR(IStRSR stRSR_) external;

    function setAssets(
        IAsset rToken_,
        IAsset rsr_,
        IAsset comp_,
        IAsset aave_
    ) external;

    function setFurnace(IFurnace furnace_) external;
}
