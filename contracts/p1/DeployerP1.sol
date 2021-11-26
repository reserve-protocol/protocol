// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./assets/RTokenAssetP1.sol";
import "./assets/RSRAssetP1.sol";
import "./assets/COMPAssetP1.sol";
import "./assets/AAVEAssetP1.sol";
import "../libraries/CommonErrors.sol";
import "./libraries/OracleP1.sol";
import "./interfaces/IAssetP1.sol";
import "./interfaces/IDeployerP1.sol";
import "./interfaces/IMainP1.sol";
import "./interfaces/IVaultP1.sol";
import "./assets/RTokenAssetP1.sol";
import "./AssetManagerP1.sol";
import "./DefaultMonitorP1.sol";
import "./FurnaceP1.sol";
import "./MainP1.sol";
import "./RTokenP1.sol";
import "./StRSRP1.sol";

/**
 * @title DeployerP1
 * @notice The deployer for the entire system.
 */
contract DeployerP1 is IDeployerP1 {
    IMainP1[] public deployments;

    /// Deploys an instance of the entire system
    /// @param name The name of the RToken to deploy
    /// @param symbol The symbol of the RToken to deploy
    /// @param owner The address that should own the entire system, hopefully a governance contract
    /// @param vault The initial vault that backs the RToken
    /// @param rsr The deployment of RSR on this chain
    /// @param config Governance params
    /// @param compound The deployment of the Comptroller on this chain
    /// @param aave The deployment of the AaveLendingPool on this chain
    /// @param nonCollateral The non-collateral assets in the system
    /// @param collateral The collateral assets in the system
    /// @return The address of the newly deployed Main instance.
    function deploy(
        string memory name,
        string memory symbol,
        address owner,
        IVaultP1 vault,
        IERC20 rsr,
        Config memory config,
        IComptroller compound,
        IAaveLendingPool aave,
        ParamsAssets memory nonCollateral,
        ICollateral[] memory collateral
    ) external override returns (address) {
        OracleP1.Info memory oracle = OracleP1.Info(compound, aave);

        MainP1 main = new MainP1(oracle, config, rsr);
        deployments.push(main);

        {
            DefaultMonitorP1 monitor = new DefaultMonitorP1(main);
            main.setMonitor(monitor);
        }

        {
            RTokenP1 rToken = new RTokenP1(main, name, symbol);
            main.setRToken(rToken);
            RTokenAssetP1 rTokenAsset = new RTokenAssetP1(address(rToken));
            main.setAssets(rTokenAsset, nonCollateral.rsrAsset, nonCollateral.compAsset, nonCollateral.aaveAsset);
            FurnaceP1 furnace = new FurnaceP1(address(rToken));
            main.setFurnace(furnace);
        }

        {
            StRSRP1 stRSR = new StRSRP1(
                main,
                string(abi.encodeWithSignature("Staked RSR - ", name)),
                string(abi.encodeWithSignature("st", symbol, "RSR"))
            );
            main.setStRSR(stRSR);
        }

        {
            AssetManagerP1 manager = new AssetManagerP1(main, vault, owner, collateral);
            main.setManager(manager);
        }
        main.setPauser(owner);
        main.transferOwnership(owner);

        emit RTokenCreated(address(main), address(main.rToken()), owner);
        return (address(main));
    }
}
