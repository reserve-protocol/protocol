// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

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
import "contracts/libraries/String.sol";

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
    IAsset public immutable rsrAsset;

    // Implementation contracts for Upgradeability
    Implementations public implementations;

    // checks: every address in the input is nonzero
    // effects: post, all contract-state values are set
    constructor(
        IERC20Metadata rsr_,
        IGnosis gnosis_,
        IFacade facade_,
        IAsset rsrAsset_,
        Implementations memory implementations_
    ) {
        require(
            address(rsr_) != address(0) &&
                address(gnosis_) != address(0) &&
                address(facade_) != address(0) &&
                address(rsrAsset_) != address(0) &&
                address(implementations_.main) != address(0) &&
                address(implementations_.trade) != address(0) &&
                address(implementations_.components.assetRegistry) != address(0) &&
                address(implementations_.components.backingManager) != address(0) &&
                address(implementations_.components.basketHandler) != address(0) &&
                address(implementations_.components.broker) != address(0) &&
                address(implementations_.components.distributor) != address(0) &&
                address(implementations_.components.furnace) != address(0) &&
                address(implementations_.components.rsrTrader) != address(0) &&
                address(implementations_.components.rTokenTrader) != address(0) &&
                address(implementations_.components.rToken) != address(0) &&
                address(implementations_.components.stRSR) != address(0),
            "invalid address"
        );

        rsr = rsr_;
        gnosis = gnosis_;
        facade = facade_;
        rsrAsset = rsrAsset_;
        implementations = implementations_;
    }

    /// Deploys an instance of the entire system
    /// @param name The name of the RToken to deploy
    /// @param symbol The symbol of the RToken to deploy
    /// @param mandate An IPFS link or direct string; describes what the RToken _should be_
    /// @param owner The address that should own the entire system, hopefully a governance contract
    /// @param params Deployment params
    /// @return The address of the newly deployed RToken.

    // effects:
    //   Deploy a proxy for Main and every component of Main
    //   Call init() on Main and every component of Main, using `params` for needed parameters
    //     While doing this, init assetRegistry with this.rsrAsset and a new rTokenAsset
    //   Set up Auth so that `owner` holds all roles and no one else has any
    function deploy(
        string memory name,
        string memory symbol,
        string calldata mandate,
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
        assets[0] = new RTokenAsset(components.rToken, params.rTokenMaxTradeVolume);
        assets[1] = rsrAsset;

        // Init Main
        main.init(components, rsr, params.shortFreeze, params.longFreeze);

        // Init Backing Manager
        main.backingManager().init(
            main,
            params.tradingDelay,
            params.backingBuffer,
            params.maxTradeSlippage,
            params.minTradeVolume
        );

        // Init Basket Handler
        main.basketHandler().init(main);

        // Init Revenue Traders
        main.rsrTrader().init(main, rsr, params.maxTradeSlippage, params.minTradeVolume);
        main.rTokenTrader().init(
            main,
            IERC20(address(rToken)),
            params.maxTradeSlippage,
            params.minTradeVolume
        );

        // Init Asset Registry
        main.assetRegistry().init(main, assets);

        // Init Distributor
        main.distributor().init(main, params.dist);

        // Init Furnace
        main.furnace().init(main, params.rewardPeriod, params.rewardRatio);

        main.broker().init(main, gnosis, implementations.trade, params.auctionLength);

        // Init StRSR
        {
            string memory stRSRSymbol = string(abi.encodePacked(StringLib.toLower(symbol), "RSR"));
            string memory stRSRName = string(abi.encodePacked(stRSRSymbol, " Token"));
            main.stRSR().init(
                main,
                stRSRName,
                stRSRSymbol,
                params.unstakingDelay,
                params.rewardPeriod,
                params.rewardRatio
            );
        }

        // Init RToken
        main.rToken().init(
            main,
            name,
            symbol,
            mandate,
            params.issuanceRate,
            params.scalingRedemptionRate,
            params.redemptionRateFloor
        );

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
