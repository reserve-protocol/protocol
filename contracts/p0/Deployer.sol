// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/plugins/assets/Asset.sol";
import "contracts/plugins/assets/RTokenAsset.sol";
import "contracts/Facade.sol";
import "contracts/p0/AssetRegistry.sol";
import "contracts/p0/BackingManager.sol";
import "contracts/p0/BasketHandler.sol";
import "contracts/p0/Broker.sol";
import "contracts/p0/Distributor.sol";
import "contracts/p0/Furnace.sol";
import "contracts/p0/Main.sol";
import "contracts/p0/Oracle.sol";
import "contracts/p0/RevenueTrader.sol";
import "contracts/p0/RToken.sol";
import "contracts/p0/StRSR.sol";
import "contracts/interfaces/IAsset.sol";
import "contracts/interfaces/IDeployer.sol";
import "contracts/interfaces/IFacade.sol";
import "contracts/interfaces/IMain.sol";

/**
 * @title DeployerP0
 * @notice The factory contract that deploys the entire P0 system.
 */
contract DeployerP0 is IDeployer {
    string public constant ENS = "reserveprotocol.eth";
    IERC20Metadata public immutable rsr;
    IGnosis public immutable gnosis;
    IFacade public immutable facade;
    AggregatorV3Interface public immutable rsrChainlinkFeed;

    constructor(
        IERC20Metadata rsr_,
        IGnosis gnosis_,
        IFacade facade_,
        AggregatorV3Interface rsrChainlinkFeed_
    ) {
        rsr = rsr_;
        gnosis = gnosis_;
        facade = facade_;
        rsrChainlinkFeed = rsrChainlinkFeed_;
    }

    /// Deploys an instance of the entire system
    /// @param name The name of the RToken to deploy
    /// @param symbol The symbol of the RToken to deploy
    /// @param manifestoURI An IPFS URI for the immutable manifesto the RToken adheres to
    /// @param owner The address that should own the entire system, hopefully a governance contract
    /// @param params Deployment params
    /// @return The address of the newly deployed Main instance.
    function deploy(
        string memory name,
        string memory symbol,
        string memory manifestoURI,
        address owner,
        DeploymentParams memory params
    ) external returns (address) {
        MainP0 main = new MainP0();

        // Components
        IRToken rToken = new RTokenP0();
        Components memory components = Components({
            stRSR: new StRSRP0(),
            rToken: rToken,
            assetRegistry: new AssetRegistryP0(),
            basketHandler: new BasketHandlerP0(),
            backingManager: new BackingManagerP0(),
            distributor: new DistributorP0(),
            rsrTrader: new RevenueTraderP0(),
            rTokenTrader: new RevenueTraderP0(),
            furnace: new FurnaceP0(),
            broker: new BrokerP0(),
            oracle: new OracleP0()
        });

        IAsset[] memory assets = new IAsset[](2);
        assets[0] = new RTokenAsset(
            main,
            IERC20Metadata(address(components.rToken)),
            params.maxTradeVolume
        );

        assets[1] = new Asset(main, rsr, params.maxTradeVolume);

        // Init Main
        main.init(components, rsr, params.oneshotPauseDuration);

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

        main.broker().init(
            main,
            gnosis,
            ITrade(address(0)),
            params.auctionLength,
            params.minBidSize
        );

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

        main.rToken().init(main, name, symbol, manifestoURI, params.issuanceRate);

        // Transfer Ownership
        main.setOneshotPauser(owner);
        main.transferOwnership(owner);

        emit RTokenCreated(main, components.rToken, components.stRSR, owner);
        return (address(main));
    }
}
