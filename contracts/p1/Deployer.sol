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
import "contracts/p0/Distributor.sol";
import "contracts/p0/RevenueTrader.sol";
import "contracts/p0/Furnace.sol";
import "contracts/p1/RToken.sol";
import "contracts/p1/StRSR.sol";
import "contracts/interfaces/IAsset.sol";
import "contracts/interfaces/IDeployer.sol";
import "contracts/interfaces/IFacade.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/p0/Main.sol";

/**
 * @title DeployerP1
 * @notice The factory contract that deploys the entire P1 system.
 */
contract DeployerP1 is IDeployer {
    string public constant ENS = "reserveprotocol.eth";
    IERC20Metadata public immutable rsr;
    IERC20Metadata public immutable comp;
    IERC20Metadata public immutable aave;
    IGnosis public immutable gnosis;
    IComptroller public immutable comptroller;
    IAaveLendingPool public immutable aaveLendingPool;

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
    /// @param constitutionURI An IPFS URI for the immutable constitution the RToken adheres to
    /// @param owner The address that should own the entire system, hopefully a governance contract
    /// @param params Deployment params
    /// @return The address of the newly deployed Main instance.
    function deploy(
        string memory name,
        string memory symbol,
        string memory constitutionURI,
        address owner,
        DeploymentParams memory params
    ) external returns (address) {
        MainP0 main = new MainP0();

        // Components
        IRToken rToken = new RTokenP1();
        Components memory components = Components({
            stRSR: new StRSRP1(),
            rToken: rToken,
            assetRegistry: new AssetRegistryP0(),
            basketHandler: new BasketHandlerP0(),
            backingManager: new BackingManagerP0(),
            distributor: new DistributorP0(),
            rsrTrader: new RevenueTradingP0(),
            rTokenTrader: new RevenueTradingP0(),
            furnace: new FurnaceP0(),
            broker: new BrokerP0()
        });

        IAsset[] memory assets = new IAsset[](4);
        assets[0] = new RTokenAsset(
            IERC20Metadata(address(components.rToken)),
            params.maxTradeVolume,
            main
        );
        assets[1] = new AavePricedAsset(rsr, params.maxTradeVolume, comptroller, aaveLendingPool);
        assets[2] = new AavePricedAsset(aave, params.maxTradeVolume, comptroller, aaveLendingPool);
        assets[3] = new CompoundPricedAsset(comp, params.maxTradeVolume, comptroller);

        // Init Main
        main.init(components, rsr);

        // Init Backing Manager
        main.backingManager().init(
            main,
            params.tradingDelay,
            params.backingBuffer,
            params.maxTradeSlippage,
            params.dustAmount
        );

        // Init Basket Handler
        main.basketHandler().init(main);

        // Init Revenue Traders
        main.rsrTrader().init(main, rsr, params.maxTradeSlippage, params.dustAmount);
        main.rTokenTrader().init(
            main,
            IERC20(address(rToken)),
            params.maxTradeSlippage,
            params.dustAmount
        );

        // Init Asset Registry
        main.assetRegistry().init(main, assets);

        // Init Distributor
        main.distributor().init(main, params.dist);

        // Init Furnace
        main.furnace().init(main, params.rewardPeriod, params.rewardRatio);

        main.broker().init(main, gnosis, params.auctionLength);

        // Init StRSR
        string memory stRSRName = string(abi.encodePacked("st", symbol, "RSR Token"));
        string memory stRSRSymbol = string(abi.encodePacked("st", symbol, "RSR"));
        main.stRSR().init(
            main,
            stRSRName,
            stRSRSymbol,
            params.unstakingDelay,
            params.rewardPeriod,
            params.rewardRatio
        );

        // Init RToken
        main.rToken().init(main, name, symbol, constitutionURI, params.issuanceRate);


        // Transfer Ownership
        main.setPauser(owner);
        main.transferOwnership(owner);

        // Facade
        IFacade facade = new FacadeP0(address(main));
        emit RTokenCreated(main, components.rToken, components.stRSR, facade, owner);
        return (address(main));
    }
}
    