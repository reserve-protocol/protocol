// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/plugins/assets/Asset.sol";
import "contracts/plugins/assets/RTokenAsset.sol";
import "contracts/facade/Facade.sol";
import "contracts/p0/AssetRegistry.sol";
import "contracts/p0/BackingManager.sol";
import "contracts/p0/BasketHandler.sol";
import "contracts/p0/Broker.sol";
import "contracts/p0/Distributor.sol";
import "contracts/p0/Furnace.sol";
import "contracts/p0/Main.sol";
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
    IAsset public immutable rsrAsset;

    constructor(
        IERC20Metadata rsr_,
        IGnosis gnosis_,
        IFacade facade_,
        IAsset rsrAsset_
    ) {
        require(
            address(rsr_) != address(0) &&
                address(gnosis_) != address(0) &&
                address(facade_) != address(0) &&
                address(rsrAsset_) != address(0),
            "invalid address"
        );
        rsr = rsr_;
        gnosis = gnosis_;
        facade = facade_;
        rsrAsset = rsrAsset_;
    }

    /// Deploys an instance of the entire system
    /// @param name The name of the RToken to deploy
    /// @param symbol The symbol of the RToken to deploy
    /// @param mandate An IPFS link or direct string; describes what the RToken _should be_
    /// @param owner The address that should own the entire system, hopefully a governance contract
    /// @param params Deployment params
    /// @return The address of the newly deployed RToken.
    function deploy(
        string memory name,
        string memory symbol,
        string calldata mandate,
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
            broker: new BrokerP0()
        });

        // Deploy RToken/RSR Assets
        IAsset[] memory assets = new IAsset[](2);
        assets[0] = new RTokenAsset(components.rToken, params.tradingRange);
        assets[1] = rsrAsset;

        // Init Main
        main.init(components, rsr, params.shortFreeze, params.longFreeze);

        // Init Backing Manager
        main.backingManager().init(
            main,
            params.tradingDelay,
            params.backingBuffer,
            params.maxTradeSlippage
        );

        // Init Basket Handler
        main.basketHandler().init(main);

        // Init Revenue Traders
        main.rsrTrader().init(main, rsr, params.maxTradeSlippage);
        main.rTokenTrader().init(main, IERC20(address(rToken)), params.maxTradeSlippage);

        // Init Asset Registry
        main.assetRegistry().init(main, assets);

        // Init Distributor
        main.distributor().init(main, params.dist);

        // Init Furnace
        main.furnace().init(main, params.rewardPeriod, params.rewardRatio);

        main.broker().init(main, gnosis, ITrade(address(0)), params.auctionLength);

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

        main.rToken().init(main, name, symbol, mandate, params.issuanceRate, params.maxRedemption);

        // Transfer Ownership
        main.grantRole(OWNER, owner);
        main.grantRole(SHORT_FREEZER, owner);
        main.grantRole(LONG_FREEZER, owner);
        main.grantRole(PAUSER, owner);
        main.renounceRole(OWNER, address(this));
        main.renounceRole(SHORT_FREEZER, address(this));
        main.renounceRole(LONG_FREEZER, address(this));
        main.renounceRole(PAUSER, address(this));

        emit RTokenCreated(main, components.rToken, components.stRSR, owner);
        return (address(components.rToken));
    }
}
