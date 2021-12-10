// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./assets/RTokenAsset.sol";
import "./assets/RSRAsset.sol";
import "./assets/COMPAsset.sol";
import "./assets/AAVEAsset.sol";
import "../libraries/CommonErrors.sol";
import "./libraries/Oracle.sol";
import "./interfaces/IAsset.sol";
import "./interfaces/IDeployer.sol";
import "./interfaces/IFurnace.sol";
import "./interfaces/IMain.sol";
import "./interfaces/IMarket.sol";
import "./interfaces/IVault.sol";
import "./assets/RTokenAsset.sol";
import "contracts/IExplorer.sol";
import "./Explorer.sol";
import "./Furnace.sol";
import "./Main.sol";
import "./RToken.sol";
import "./StRSR.sol";

/**
 * @title DeployerP0
 * @notice The deployer for the entire system.
 */
contract DeployerP0 is IDeployer {
    IMarket internal market;
    IAsset internal rsrAsset;
    IAsset internal compAsset;
    IAsset internal aaveAsset;
    IMain[] public deployments;

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
    /// @param dist The revenue shares distribution
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
        RevenueShare memory dist,
        IComptroller compound,
        IAaveLendingPool aave,
        ICollateral[] memory collateral
    ) external override returns (address) {
        Oracle.Info memory oracle = Oracle.Info(compound, aave);

        IMain main;
        {
            IRToken rToken = _deployRToken(name, symbol);
            RTokenAssetP0 rTokenAsset = new RTokenAssetP0(address(rToken));
            IFurnace revenueFurnace = _deployRevenueFurnace(rToken, config.rewardPeriod);
            Ownable(address(revenueFurnace)).transferOwnership(owner);

            main = _deployMain(
                ConstructorArgs(
                    collateral,
                    oracle,
                    config,
                    dist,
                    rTokenAsset,
                    rsrAsset,
                    compAsset,
                    aaveAsset,
                    vault,
                    revenueFurnace,
                    market
                )
            );
            deployments.push(main);
            rToken.setMain(address(main));
            Ownable(address(rToken)).transferOwnership(owner);
        }

        {
            IStRSR stRSR = _deployStRSR(
                main,
                string(abi.encodePacked("st", symbol, "RSR Token")),
                string(abi.encodePacked("st", symbol, "RSR"))
            );
            main.setStRSR(stRSR);
        }

        main.setPauser(owner);
        Ownable(address(main)).transferOwnership(owner);

        IExplorer explorer = new ExplorerP0(address(main));
        emit RTokenCreated(address(main), address(main.rToken()), address(explorer), owner);
        return (address(main));
    }

    // =================================================================
    /// @dev Helpers used for testing to inject msg.sender and implement contract invariant checks

    function _deployMain(ConstructorArgs memory args) internal virtual returns (IMain) {
        IMain m = new MainP0();
        m.init(args);
        return m;
    }

    function _deployRToken(string memory name, string memory symbol)
        internal
        virtual
        returns (IRToken)
    {
        return new RTokenP0(name, symbol);
    }

    function _deployRevenueFurnace(IRToken rToken, uint256 batchDuration)
        internal
        virtual
        returns (IFurnace)
    {
        return new FurnaceP0(rToken, batchDuration);
    }

    function _deployStRSR(
        IMain main,
        string memory name,
        string memory symbol
    ) internal virtual returns (IStRSR) {
        return new StRSRP0(main, name, symbol);
    }
}
