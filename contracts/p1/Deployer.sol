// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "contracts/interfaces/IAsset.sol";
import "contracts/interfaces/IAssetRegistry.sol";
import "contracts/interfaces/IBackingManager.sol";
import "contracts/interfaces/IBasketHandler.sol";
import "contracts/interfaces/IBroker.sol";
import "contracts/interfaces/IDeployer.sol";
import "contracts/interfaces/IDistributor.sol";
import "contracts/interfaces/IFacade.sol";
import "contracts/interfaces/IFurnace.sol";
import "contracts/interfaces/IRevenueTrader.sol";
import "contracts/interfaces/IRToken.sol";
import "contracts/interfaces/IStRSR.sol";
import "contracts/plugins/assets/Asset.sol";
import "contracts/plugins/assets/RTokenAsset.sol";
import "contracts/p1/Main.sol";

/**
 * @title DeployerP1
 * @notice The factory contract that deploys the entire P1 system.
 */
contract DeployerP1 is IDeployer {
    using Clones for address;

    string public constant ENS = "reserveprotocol.eth";
    IERC20Metadata public immutable rsr;
    IGnosis public immutable gnosis;
    IFacade public immutable facade;
    AggregatorV3Interface public immutable rsrChainlinkFeed;

    // Implementation contracts for Upgradeability
    Implementations public implementations;

    constructor(
        IERC20Metadata rsr_,
        IGnosis gnosis_,
        IFacade facade_,
        AggregatorV3Interface rsrChainlinkFeed_,
        Implementations memory implementations_
    ) {
        rsr = rsr_;
        gnosis = gnosis_;
        facade = facade_;
        implementations = implementations_;
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
        // Main - Proxy
        MainP1 main = MainP1(
            address(new ERC1967Proxy(address(implementations.main), new bytes(0)))
        );

        // Components - Proxies
        IRToken rToken = IRToken(
            address(new ERC1967Proxy(address(implementations.components.rToken), new bytes(0)))
        );
        Components memory components = Components({
            stRSR: IStRSR(
                address(new ERC1967Proxy(address(implementations.components.stRSR), new bytes(0)))
            ),
            rToken: rToken,
            assetRegistry: IAssetRegistry(
                address(
                    new ERC1967Proxy(
                        address(implementations.components.assetRegistry),
                        new bytes(0)
                    )
                )
            ),
            basketHandler: IBasketHandler(
                address(
                    new ERC1967Proxy(
                        address(implementations.components.basketHandler),
                        new bytes(0)
                    )
                )
            ),
            backingManager: IBackingManager(
                address(
                    new ERC1967Proxy(
                        address(implementations.components.backingManager),
                        new bytes(0)
                    )
                )
            ),
            distributor: IDistributor(
                address(
                    new ERC1967Proxy(address(implementations.components.distributor), new bytes(0))
                )
            ),
            rsrTrader: IRevenueTrader(
                address(
                    new ERC1967Proxy(address(implementations.components.rsrTrader), new bytes(0))
                )
            ),
            rTokenTrader: IRevenueTrader(
                address(
                    new ERC1967Proxy(address(implementations.components.rTokenTrader), new bytes(0))
                )
            ),
            furnace: IFurnace(
                address(new ERC1967Proxy(address(implementations.components.furnace), new bytes(0)))
            ),
            broker: IBroker(
                address(new ERC1967Proxy(address(implementations.components.broker), new bytes(0)))
            )
        });

        // Deploy RToken/RSR Assets
        IAsset[] memory assets = new IAsset[](2);
        {
            RTokenAsset rTokAsset = new RTokenAsset();
            rTokAsset.RTokenAsset_init(
                main,
                IERC20Metadata(address(components.rToken)),
                params.maxTradeVolume
            );
            assets[0] = rTokAsset;

            Asset rsrAsset = new Asset();
            rsrAsset.Asset_init(rsrChainlinkFeed, rsr, params.maxTradeVolume);
            assets[1] = rsrAsset;
        }

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
            implementations.trade,
            params.auctionLength,
            params.minBidSize
        );

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
        main.rToken().init(main, name, symbol, manifestoURI, params.issuanceRate);

        // Transfer Ownership
        main.setOneshotPauser(owner);
        main.transferOwnership(owner);

        emit RTokenCreated(main, components.rToken, components.stRSR, owner);
        return (address(main));
    }
}
