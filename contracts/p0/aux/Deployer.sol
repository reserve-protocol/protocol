// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/plugins/assets/AavePricedAsset.sol";
import "contracts/plugins/assets/CompoundPricedAsset.sol";
import "contracts/plugins/assets/RTokenAsset.sol";
import "contracts/plugins/assets/abstract/AaveOracleMixin.sol";
import "contracts/plugins/assets/abstract/CompoundOracleMixin.sol";
import "contracts/plugins/assets/RTokenAsset.sol";
import "contracts/p0/aux/Facade.sol";
import "contracts/p0/AssetRegistry.sol";
import "contracts/p0/BackingManager.sol";
import "contracts/p0/BasketHandler.sol";
import "contracts/p0/Broker.sol";
import "contracts/p0/RToken.sol";
import "contracts/p0/Distributor.sol";
import "contracts/p0/RevenueTrader.sol";
import "contracts/p0/StRSR.sol";
import "contracts/p0/Furnace.sol";
import "contracts/interfaces/IAsset.sol";
import "contracts/interfaces/IDeployer.sol";
import "contracts/interfaces/IFacade.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/p0/Main.sol";

/**
 * @title DeployerP0
 * @notice The deployer for the entire system.
 */
contract DeployerP0 is IDeployer {
    IERC20Metadata public immutable rsr;
    IERC20Metadata public immutable comp;
    IERC20Metadata public immutable aave;
    IGnosis public immutable gnosis;
    IComptroller public immutable comptroller;
    IAaveLendingPool public immutable aaveLendingPool;

    IMain[] public deployments;

    constructor(
        IERC20Metadata rsr_,
        IERC20Metadata comp_,
        IERC20Metadata aave_,
        IGnosis gnosis_,
        IComptroller comptroller_,
        IAaveLendingPool aaveLendingPool_
    ) {
        rsr = rsr_;
        comp = comp_;
        aave = aave_;
        gnosis = gnosis_;
        comptroller = comptroller_;
        aaveLendingPool = aaveLendingPool_;
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
        MainP0 main = new MainP0();
        deployments.push(main);

        // Components
        Components memory components;
        components.rToken = new RTokenP0(name, symbol);
        string memory stRSRName = string(abi.encodePacked("st", symbol, "RSR Token"));
        string memory stRSRSymbol = string(abi.encodePacked("st", symbol, "RSR"));
        components.stRSR = new StRSRP0(stRSRName, stRSRSymbol);
        components.rToken = new RTokenP0(name, symbol);
        components.assetRegistry = new AssetRegistryP0();
        components.basketHandler = new BasketHandlerP0();
        components.backingManager = new BackingManagerP0();
        components.distributor = new DistributorP0();
        components.rsrTrader = new RevenueTradingP0(rsr);
        components.rTokenTrader = new RevenueTradingP0(components.rToken);
        components.furnace = new FurnaceP0();
        components.broker = new BrokerP0();

        IAsset[] memory assets = new IAsset[](4);
        assets[0] = new RTokenAsset(components.rToken, params.maxAuctionSize, main);
        assets[1] = new AavePricedAsset(rsr, params.maxAuctionSize, comptroller, aaveLendingPool);
        assets[2] = new AavePricedAsset(aave, params.maxAuctionSize, comptroller, aaveLendingPool);
        assets[3] = new CompoundPricedAsset(comp, params.maxAuctionSize, comptroller);

        // ConstructorArgs
        ConstructorArgs memory ctorArgs = ConstructorArgs(params, components, rsr, gnosis, assets);

        // Init main
        main.init(ctorArgs);

        // Roles
        main.setPauser(owner);
        Ownable(address(main)).transferOwnership(owner);

        // Facade
        IFacade facade = new FacadeP0(address(main));
        emit RTokenCreated(main, components.rToken, components.stRSR, facade, owner);
        return (address(main));
    }
}
