// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "contracts/p0/adapters/AaveClaimAdapter.sol";
import "contracts/p0/adapters/CompoundClaimAdapter.sol";
import "contracts/p0/assets/AavePricedAsset.sol";
import "contracts/p0/assets/CompoundPricedAsset.sol";
import "contracts/p0/assets/RTokenAsset.sol";
import "contracts/p0/assets/abstract/AaveOracleMixin.sol";
import "contracts/p0/assets/abstract/CompoundOracleMixin.sol";
import "contracts/p0/interfaces/IAsset.sol";
import "contracts/p0/interfaces/IClaimAdapter.sol";
import "contracts/p0/interfaces/IDeployer.sol";
import "contracts/p0/interfaces/IFurnace.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/interfaces/IMarket.sol";
import "contracts/p0/assets/RTokenAsset.sol";
import "contracts/p0/ExplorerFacade.sol";
import "contracts/p0/Furnace.sol";
import "contracts/p0/Main.sol";
import "contracts/p0/RToken.sol";
import "contracts/p0/StRSR.sol";
import "contracts/IExplorerFacade.sol";
import "contracts/libraries/CommonErrors.sol";

/**
 * @title DeployerP0
 * @notice The deployer for the entire system.
 */
contract DeployerP0 is IDeployer {
    IERC20Metadata public immutable rsr;
    IERC20Metadata public immutable comp;
    IERC20Metadata public immutable aave;
    IMarket public immutable market;
    IComptroller public immutable comptroller;
    IAaveLendingPool public immutable aaveLendingPool;

    IClaimAdapter public immutable compoundClaimer;
    IClaimAdapter public immutable aaveClaimer;

    IMain[] public deployments;

    constructor(
        IERC20Metadata rsr_,
        IERC20Metadata comp_,
        IERC20Metadata aave_,
        IMarket market_,
        IComptroller comptroller_,
        IAaveLendingPool aaveLendingPool_
    ) {
        rsr = rsr_;
        comp = comp_;
        aave = aave_;
        market = market_;
        comptroller = comptroller_;
        aaveLendingPool = aaveLendingPool_;
        compoundClaimer = new CompoundClaimAdapterP0(comptroller_, address(comp_));
        aaveClaimer = new AaveClaimAdapterP0(address(aave_));
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
            IFurnace revenueFurnace = deployRevenueFurnace(
                rToken,
                config.rewardPeriod,
                Fix.wrap(0.1591e18) // TODO: Route through a deploy() argument?
            );
            Ownable(address(revenueFurnace)).transferOwnership(owner);

            IClaimAdapter[] memory claimAdapters = new IClaimAdapter[](2);
            claimAdapters[0] = compoundClaimer;
            claimAdapters[1] = aaveClaimer;

            ctorArgs = ConstructorArgs(config, dist, revenueFurnace, market, claimAdapters);

            RTokenAssetP0 rTokenAsset = new RTokenAssetP0(rToken, main);
            main.setRTokenAsset(rTokenAsset);
            main.activateAsset(rTokenAsset);
        }

        {
            AssetP0 rsrAsset = new AavePricedAssetP0(rsr, comptroller, aaveLendingPool);
            AssetP0 aaveAsset = new AavePricedAssetP0(aave, comptroller, aaveLendingPool);
            AssetP0 compAsset = new CompoundPricedAssetP0(comp, comptroller);

            main.setRSRAsset(rsrAsset);
            main.activateAsset(rsrAsset);
            main.addAsset(aaveAsset);
            main.activateAsset(aaveAsset);
            main.addAsset(compAsset);
            main.activateAsset(compAsset);
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

    function deployRevenueFurnace(
        IRToken rToken,
        uint256 period,
        Fix ratio
    ) internal virtual returns (IFurnace) {
        return new FurnaceP0(rToken, period, ratio);
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
