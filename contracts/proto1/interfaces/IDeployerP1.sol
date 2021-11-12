// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../assets/RSRAssetP1.sol";
import "../assets/COMPAssetP1.sol";
import "../assets/AAVEAssetP1.sol";
import "./IAsset.sol";
import "./IVault.sol";

/**
 * @title IDeployer
 * @notice The deployer for the entire system.
 */
interface IDeployer {
    /// Emitted when a new RToken and accompanying system is deployed
    /// @param main The address of `Main`
    /// @param owner The owner of the newly deployed system
    event RTokenCreated(address indexed main, address indexed rToken, address indexed owner);

    //

    /// @param rsrAsset RSR as an IAsset
    /// @param compAsset COMP as an IAsset
    /// @param aaveAsset AAVE as an IAsset
    struct ParamsAssets {
        RSRAssetP1 rsrAsset;
        COMPAssetP1 compAsset;
        AAVEAssetP1 aaveAsset;
    }

    /// Deploys an instance of the entire system
    /// @param name The name of the RToken to deploy
    /// @param symbol The symbol of the RToken to deploy
    /// @param owner The address that should own the entire system, hopefully a governance contract
    /// @param vault The initial vault that backs the RToken
    /// @param rsr The deployment of RSR on this chain
    /// @param config Governance param
    /// @param compound The deployment of the Comptroller on this chain
    /// @param aave The deployment of the AaveLendingPool on this chain
    /// @param nonCollateral The non-collateral assets in the system
    /// @param collateral The collateral assets in the system
    /// @return The address of the newly deployed Main instance.
    function deploy(
        string memory name,
        string memory symbol,
        address owner,
        IVault vault,
        IERC20 rsr,
        Config memory config,
        IComptroller compound,
        IAaveLendingPool aave,
        ParamsAssets memory nonCollateral,
        ICollateral[] memory collateral
    ) external returns (address);
}
