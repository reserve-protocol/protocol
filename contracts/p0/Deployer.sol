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
import "./assets/RTokenAsset.sol";
import "contracts/IExplorerFacade.sol";
import "./ExplorerFacade.sol";
import "./Furnace.sol";
import "./Main.sol";
import "./RToken.sol";
import "./StRSR.sol";

/**
 * @title DeployerP0
 * @notice The deployer for the entire system.
 */
contract DeployerP0 is IDeployer {
    IERC20Metadata public rsr;
    IERC20Metadata public comp;
    IERC20Metadata public aave;
    IMarket public market;
    IOracle public compoundOracle;
    IOracle public aaveOracle;
    IMain[] public deployments;

    constructor(
        IERC20Metadata rsr_,
        IERC20Metadata comp_,
        IERC20Metadata aave_,
        IMarket market_,
        IOracle compoundOracle_,
        IOracle aaveOracle_
    ) {
        rsr = rsr_;
        comp = comp_;
        aave = aave_;
        market = market_;
        compoundOracle = compoundOracle_;
        aaveOracle = aaveOracle_;
    }

    /// Deploys an instance of the entire system
    /// @param name The name of the RToken to deploy
    /// @param symbol The symbol of the RToken to deploy
    /// @param owner The address that should own the entire system, hopefully a governance contract
    /// @param config Governance params
    /// @param dist The revenue shares distribution
    /// @return The address of the newly deployed Main instance.
    function deploy(
        string memory name,
        string memory symbol,
        address owner,
        Config memory config,
        RevenueShare memory dist
    ) external override returns (address) {
        ConstructorArgs memory ctorArgs;

        IMain main = deployMain();
        deployments.push(main);

        {
            IRToken rToken = deployRToken(main, name, symbol, owner);
            IFurnace revenueFurnace = deployRevenueFurnace(rToken, config.rewardPeriod);
            Ownable(address(revenueFurnace)).transferOwnership(owner);

            ctorArgs = ConstructorArgs(config, dist, revenueFurnace, market);

            RTokenAssetP0 rTokenAsset = new RTokenAssetP0(rToken, main, aaveOracle);
            main.setRTokenAsset(rTokenAsset);
        }

        {
            AssetP0 rsrAsset = new AssetP0(rsr, main, aaveOracle);
            AssetP0 compAsset = new AssetP0(comp, main, compoundOracle);
            AssetP0 aaveAsset = new AssetP0(aave, main, aaveOracle);

            main.setRSRAsset(rsrAsset);
            main.setCOMPAsset(compAsset);
            main.setAAVEAsset(aaveAsset);
        }

        {
            IStRSR stRSR = deployStRSR(
                main,
                string(abi.encodePacked("st", symbol, "RSR Token")),
                string(abi.encodePacked("st", symbol, "RSR")),
                owner
            );
            main.setStRSR(stRSR);
        }

        main.init(ctorArgs);

        main.setPauser(owner);
        Ownable(address(main)).transferOwnership(owner);

        IExplorerFacade facade = new ExplorerFacadeP0(address(main));
        emit RTokenCreated(main, main.rToken(), main.stRSR(), facade, owner);
        return (address(main));
    }

    // =================================================================
    /// @dev Helpers used for testing to inject msg.sender and implement contract invariant checks

    function deployMain() internal virtual returns (IMain) {
        return new MainP0();
    }

    function deployRToken(
        IMain main,
        string memory name,
        string memory symbol,
        address owner
    ) internal virtual returns (IRToken) {
        return new RTokenP0(main, name, symbol, owner);
    }

    function deployRevenueFurnace(IRToken rToken, uint256 batchDuration)
        internal
        virtual
        returns (IFurnace)
    {
        return new FurnaceP0(rToken, batchDuration);
    }

    function deployStRSR(
        IMain main,
        string memory name,
        string memory symbol,
        address owner
    ) internal virtual returns (IStRSR) {
        return new StRSRP0(main, name, symbol, owner);
    }
}
