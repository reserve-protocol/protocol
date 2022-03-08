// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "contracts/plugins/adapters/AaveClaimAdapter.sol";
import "contracts/plugins/adapters/CompoundClaimAdapter.sol";
import "contracts/plugins/assets/AavePricedAsset.sol";
import "contracts/plugins/assets/CompoundPricedAsset.sol";
import "contracts/plugins/assets/RTokenAsset.sol";
import "contracts/plugins/assets/abstract/AaveOracleMixin.sol";
import "contracts/plugins/assets/abstract/CompoundOracleMixin.sol";
import "contracts/interfaces/IAsset.sol";
import "contracts/interfaces/IClaimAdapter.sol";
import "contracts/interfaces/IDeployer.sol";
import "contracts/interfaces/IFacade.sol";
import "contracts/interfaces/IFurnace.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/interfaces/IMarket.sol";
import "contracts/plugins/assets/RTokenAsset.sol";
import "contracts/p0/AssetRegistry.sol";
import "contracts/p0/BackingManager.sol";
import "contracts/p0/BasketHandler.sol";
import "contracts/p0/Facade.sol";
import "contracts/p0/Furnace.sol";
import "contracts/p0/Main.sol";
import "contracts/p0/RToken.sol";
import "contracts/p0/Distributor.sol";
import "contracts/p0/StRSR.sol";

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
    /// @param params Deployment params
    /// @return The address of the newly deployed Main instance.
    function deploy(
        string memory name,
        string memory symbol,
        address owner,
        DeploymentParams memory params
    ) external returns (address) {
        IRToken rToken = deployRToken(name, symbol);
        IMain main = deployMain();
        deployments.push(main);

        // Periphery
        Periphery memory periphery;
        periphery.furnace = deployFurnace(rToken, params.rewardPeriod, params.rewardRatio);
        Ownable(address(periphery.furnace)).transferOwnership(owner);
        periphery.market = market;
        periphery.assets = new IAsset[](4);
        periphery.assets[0] = new RTokenAssetP0(rToken, params.maxAuctionSize, main);
        periphery.assets[1] = new AavePricedAssetP0(
            rsr,
            params.maxAuctionSize,
            comptroller,
            aaveLendingPool
        );
        periphery.assets[2] = new AavePricedAssetP0(
            aave,
            params.maxAuctionSize,
            comptroller,
            aaveLendingPool
        );
        periphery.assets[3] = new CompoundPricedAssetP0(comp, params.maxAuctionSize, comptroller);

        // Core
        Core memory components;
        components.rToken = rToken;
        components.stRSR = deployStRSR(
            string(abi.encodePacked("st", symbol, "RSR Token")),
            string(abi.encodePacked("st", symbol, "RSR"))
        );
        components.rToken = rToken;
        components.assetRegistry = new AssetRegistryP0();
        components.basketHandler = new BasketHandlerP0();
        components.backingManager = new BackingManagerP0();
        components.distributor = new DistributorP0();
        components.rsrTrader = new RevenueTraderP0(rsr);
        components.rTokenTrader = new RevenueTraderP0(rToken);

        // ConstructorArgs
        ConstructorArgs memory ctorArgs = ConstructorArgs(params, components, periphery, rsr);

        // Init main
        main.init(ctorArgs);

        // Roles
        main.setPauser(owner);
        Ownable(address(main)).transferOwnership(owner);

        // Facade
        IFacade facade = new FacadeP0(address(main));
        emit RTokenCreated(main, rToken, ctorArgs.core.stRSR, facade, owner);
        return (address(main));
    }

    // =================================================================
    /// @dev Helpers used for testing to inject msg.sender and implement contract invariant checks

    function deployMain() internal virtual returns (IMain) {
        return new MainP0();
    }

    function deployRToken(string memory name, string memory symbol)
        internal
        virtual
        returns (IRToken)
    {
        return new RTokenP0(name, symbol);
    }

    function deployFurnace(
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
