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
import "./interfaces/IAssetManager.sol";
import "./interfaces/IDeployer.sol";
import "./interfaces/IFurnace.sol";
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
    IMainP0[] public deployments;
    IMarket internal market;
    IAsset internal rsrAsset;
    IAsset internal compAsset;
    IAsset internal aaveAsset;

    constructor(
        IAsset rsrAsset_,
        IAsset compAsset_,
        IAsset aaveAsset_,
        IMarket market_
    ) {
        rsrAsset = rsrAsset_;
        compAsset = compAsset_;
        aaveAsset = aaveAsset_;
        market = market_;
    }

    /// Deploys an instance of the entire system
    /// @param name The name of the RToken to deploy
    /// @param symbol The symbol of the RToken to deploy
    /// @param owner The address that should own the entire system, hopefully a governance contract
    /// @param vault The initial vault that backs the RToken
    /// @param config Governance params
    /// @param compound The deployment of the Comptroller on this chain
    /// @param aave The deployment of the AaveLendingPool on this chain
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
        ICollateral[] memory collateral
    ) external override returns (address) {
        Oracle.Info memory oracle = Oracle.Info(compound, aave);

        IMainP0 main = _deployMain(oracle, config);
        deployments.push(main);

        {
            DefaultMonitorP0 monitor = new DefaultMonitorP0(main);
            main.setMonitor(monitor);
        }

        {
            IRToken rToken = _deployRToken(main, name, symbol);
            RTokenAssetP0 rTokenAsset = new RTokenAssetP0(address(rToken));
            main.setAssets(rTokenAsset, rsrAsset, compAsset, aaveAsset);
            IFurnace furnace = _deployFurnace(address(rToken));
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
            IAssetManager manager = _deployAssetManager(main, vault, owner, collateral);
            main.setManager(manager);
        }
        main.setPauser(owner);
        IOwnable(address(main)).transferOwnership(owner);

        emit RTokenCreated(address(main), address(main.rToken()), owner);
        return (address(main));
    }

    /// @dev Helpers used for testing to inject msg.sender and implement contract invariant checks
    function _deployMain(Oracle.Info memory oracle, Config memory config) internal virtual returns (IMainP0) {
        return IMainP0(address(new MainP0(oracle, config)));
    }

    function _deployRToken(
        IMainP0 main,
        string memory name,
        string memory symbol
    ) internal virtual returns (IRToken) {
        return new RTokenP0(main, name, symbol);
    }

    function _deployFurnace(address rToken) internal virtual returns (IFurnace) {
        return new FurnaceP0(address(rToken));
    }

    function _deployStRSR(
        IMainP0 main,
        string memory name,
        string memory symbol
    ) internal virtual returns (IStRSR) {
        return new StRSRP0(main, name, symbol);
    }

    function _deployAssetManager(
        IMain main_,
        IVault vault_,
        address owner_,
        ICollateral[] memory approvedCollateral_
    ) internal virtual returns (IAssetManager) {
        return new AssetManagerP0(main_, vault_, market, owner_, approvedCollateral_);
    }
}
