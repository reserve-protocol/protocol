// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./assets/RTokenAsset.sol";
import "../libraries/CommonErrors.sol";
import "./interfaces/IAsset.sol";
import "./interfaces/IDeployer.sol";
import "./interfaces/IFurnace.sol";
import "./interfaces/IMain.sol";
import "./interfaces/IMarket.sol";
import "./interfaces/IOracle.sol";
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
    IERC20Metadata internal rsr;
    IERC20Metadata internal comp;
    IERC20Metadata internal aave;
    IMain[] public deployments;

    constructor(
        IERC20Metadata rsr_,
        IERC20Metadata comp_,
        IERC20Metadata aave_,
        IMarket market_
    ) {
        rsr = rsr_;
        comp = comp_;
        aave = aave_;
        market = market_;
    }

    /// Deploys an instance of the entire system
    /// @param name The name of the RToken to deploy
    /// @param symbol The symbol of the RToken to deploy
    /// @param owner The address that should own the entire system, hopefully a governance contract
    /// @param vault The initial vault that backs the RToken
    /// @param config Governance params
    /// @param dist The revenue shares distribution
    /// @param compoundOracle A deployment of an adapter for the compound oracle
    /// @param aaveOracle A deployment of an adapter for the aave oracle
    /// @param collateral The collateral assets in the system
    /// @return The address of the newly deployed Main instance.
    function deploy(
        string memory name,
        string memory symbol,
        address owner,
        IVault vault,
        Config memory config,
        RevenueShare memory dist,
        IOracle compoundOracle,
        IOracle aaveOracle,
        ICollateral[] memory collateral
    ) external override returns (address) {
        ConstructorArgs memory ctorArgs;

        IMain main = _deployMain();
        deployments.push(main);

        {
            IRToken rToken = _deployRToken(name, symbol);
            IFurnace revenueFurnace = _deployRevenueFurnace(rToken, config.rewardPeriod);
            Ownable(address(revenueFurnace)).transferOwnership(owner);

            ctorArgs = ConstructorArgs(collateral, config, dist, vault, revenueFurnace, market);

            RTokenAssetP0 rTokenAsset = new RTokenAssetP0(rToken, main, aaveOracle);
            main.setRTokenAsset(rTokenAsset);

            rToken.setMain(main);
            Ownable(address(rToken)).transferOwnership(owner);
        }

        {
            AssetP0 rsrAsset = new AssetP0(UoA.USD, rsr, main, aaveOracle);
            AssetP0 compAsset = new AssetP0(UoA.USD, comp, main, compoundOracle);
            AssetP0 aaveAsset = new AssetP0(UoA.USD, aave, main, aaveOracle);

            main.setRSRAsset(rsrAsset);
            main.setCompAsset(compAsset);
            main.setAaveAsset(aaveAsset);
        }

        {
            IStRSR stRSR = _deployStRSR(
                main,
                string(abi.encodePacked("st", symbol, "RSR Token")),
                string(abi.encodePacked("st", symbol, "RSR"))
            );
            main.setStRSR(stRSR);
        }

        main.init(ctorArgs);

        main.setPauser(owner);
        Ownable(address(main)).transferOwnership(owner);

        IExplorer explorer = new ExplorerP0(address(main));
        emit RTokenCreated(address(main), address(main.rToken()), address(explorer), owner);
        return (address(main));
    }

    // =================================================================
    /// @dev Helpers used for testing to inject msg.sender and implement contract invariant checks

    function _deployMain() internal virtual returns (IMain) {
        return new MainP0();
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
