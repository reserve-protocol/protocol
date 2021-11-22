// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./assets/RTokenAssetP0.sol";
import "./assets/RSRAssetP0.sol";
import "./assets/COMPAssetP0.sol";
import "./assets/AAVEAssetP0.sol";
import "../libraries/CommonErrors.sol";
import "./libraries/Oracle.sol";
import "./interfaces/IAsset.sol";
import "./interfaces/IDeployer.sol";
import "./interfaces/IMain.sol";
import "./interfaces/IVault.sol";
import "./assets/RTokenAssetP0.sol";
import "./AssetManagerP0.sol";
import "./DefaultMonitorP0.sol";
import "./FurnaceP0.sol";
import "./MainP0.sol";
import "./RTokenP0.sol";
import "./StRSRP0.sol";

/**
 * @dev Transfers ownership of the contract to a new account (`newOwner`).
 * Can only be called by the current owner.
 */
interface IOwnable {
    function transferOwnership(address newOwner) external;
}

/**
 * @title DeployerP0
 * @notice The deployer for the entire system.
 */
contract DeployerP0 is IDeployer {
    IMain[] public deployments;

    /// Deploys an instance of the entire system
    /// @param name The name of the RToken to deploy
    /// @param symbol The symbol of the RToken to deploy
    /// @param owner The address that should own the entire system, hopefully a governance contract
    /// @param vault The initial vault that backs the RToken
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
        IVault vault,
        Config memory config,
        IComptroller compound,
        IAaveLendingPool aave,
        ParamsAssets memory nonCollateral,
        ICollateral[] memory collateral
    ) external override returns (address) {
        Oracle.Info memory oracle = Oracle.Info(compound, aave);

        IMain main = _deployMain(oracle, config);
        deployments.push(main);

        {
            DefaultMonitorP0 monitor = new DefaultMonitorP0(main);
            main.setMonitor(monitor);
        }

        {
            IRToken rToken = _deployRToken(main, name, symbol);
            RTokenAssetP0 rTokenAsset = new RTokenAssetP0(address(rToken));
            main.setAssets(rTokenAsset, nonCollateral.rsrAsset, nonCollateral.compAsset, nonCollateral.aaveAsset);
            FurnaceP0 furnace = new FurnaceP0(address(rToken));
            main.setFurnace(furnace);
        }

        {
            IStRSR stRSR = _deployStRSR(
                main,
                string(abi.encodePacked("st", symbol, "RSR Token")),
                string(abi.encodePacked("st", symbol, "RSR"))
            );
            main.setStRSR(stRSR);
        }

        {
            AssetManagerP0 manager = new AssetManagerP0(main, vault, owner, collateral);
            main.setManager(manager);
        }
        main.setPauser(owner);
        IOwnable(address(main)).transferOwnership(owner);

        emit RTokenCreated(address(main), address(main.rToken()), owner);
        return (address(main));
    }

    /// @dev Used for testing to inject msg.sender
    function _deployMain(Oracle.Info memory oracle, Config memory config) internal virtual returns (IMain) {
        return new MainP0(oracle, config);
    }

    /// @dev Used for testing to inject msg.sender
    function _deployRToken(
        IMain main,
        string memory name,
        string memory symbol
    ) internal virtual returns (IRToken) {
        return new RTokenP0(main, name, symbol);
    }

    /// @dev Used for testing to inject msg.sender
    function _deployStRSR(
        IMain main,
        string memory name,
        string memory symbol
    ) internal virtual returns (IStRSR) {
        return new StRSRP0(main, name, symbol);
    }
}
