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
import "contracts/p0/AssetRegistry.sol";
import "contracts/p0/BackingManager.sol";
import "contracts/p0/BasketHandler.sol";
import "contracts/p0/ExplorerFacade.sol";
import "contracts/p0/Furnace.sol";
import "contracts/p0/Main.sol";
import "contracts/p0/RToken.sol";
import "contracts/p0/RTokenIssuer.sol";
import "contracts/p0/RevenueDistributor.sol";
import "contracts/p0/Settings.sol";
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
        compoundClaimer = new CompoundClaimAdapterP0(comptroller_, comp_);
        aaveClaimer = new AaveClaimAdapterP0(aave_);
    }

    /// Deploys an instance of the entire system
    /// @param name The name of the RToken to deploy
    /// @param symbol The symbol of the RToken to deploy
    /// @param owner The address that should own the entire system, hopefully a governance contract
    /// @param config Governance params
    /// @param dist The revenue shares distribution
    /// @param maxAuctionSize {UoA} The max auction size to use for RToken/RSR/COMP/AAVE
    /// @return The address of the newly deployed Main instance.
    function deploy(
        string memory name,
        string memory symbol,
        address owner,
        Config memory config,
        RevenueShare memory dist,
        Fix maxAuctionSize
    ) external override returns (address) {
        IMain main = deployMain();
        deployments.push(main);

        // Prepare ConstructorArgs while deploying most of the system
        ConstructorArgs memory ctorArgs;
        ctorArgs.config = config;
        ctorArgs.dist = dist;
        ctorArgs.market = market;
        ctorArgs.rsr = rsr;
        ctorArgs.stRSR = deployStRSR(
            string(abi.encodePacked("st", symbol, "RSR Token")),
            string(abi.encodePacked("st", symbol, "RSR"))
        );
        ctorArgs.rToken = deployRToken(main, name, symbol, owner);

        Fix furnaceRatio = config.stRSRPayRatio;
        ctorArgs.furnace = deployRevenueFurnace(ctorArgs.rToken, config.rewardPeriod, furnaceRatio);
        Ownable(address(ctorArgs.furnace)).transferOwnership(owner);

        ctorArgs.claimAdapters = new IClaimAdapter[](2);
        ctorArgs.claimAdapters[0] = compoundClaimer;
        ctorArgs.claimAdapters[1] = aaveClaimer;

        ctorArgs.assets = new IAsset[](4);
        ctorArgs.assets[0] = new RTokenAssetP0(ctorArgs.rToken, maxAuctionSize, main);
        ctorArgs.assets[1] = new AavePricedAssetP0(
            rsr,
            maxAuctionSize,
            comptroller,
            aaveLendingPool
        );
        ctorArgs.assets[2] = new AavePricedAssetP0(
            aave,
            maxAuctionSize,
            comptroller,
            aaveLendingPool
        );
        ctorArgs.assets[3] = new CompoundPricedAssetP0(comp, maxAuctionSize, comptroller);

        ctorArgs.assetRegistry = new AssetRegistryP0();
        ctorArgs.backingManager = new BackingManagerP0();
        ctorArgs.basketHandler = new BasketHandlerP0();
        ctorArgs.rTokenIssuer = new RTokenIssuerP0();
        ctorArgs.revenueDistributor = new RevenueDistributorP0();
        ctorArgs.settings = new SettingsP0();
        ctorArgs.rsrTrader = new RevenueTraderP0(ctorArgs.rsr);
        ctorArgs.rTokenTrader = new RevenueTraderP0(ctorArgs.rToken);

        // Init main
        main.init(ctorArgs);

        // Roles
        main.setPauser(owner);
        Ownable(address(main)).transferOwnership(owner);

        // Facade
        IExplorerFacade facade = new ExplorerFacadeP0(address(main));
        emit RTokenCreated(main, ctorArgs.rToken, ctorArgs.stRSR, facade, owner);
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

    function deployStRSR(string memory name, string memory symbol)
        internal
        virtual
        returns (IStRSR)
    {
        return new StRSRP0(name, symbol);
    }
}
