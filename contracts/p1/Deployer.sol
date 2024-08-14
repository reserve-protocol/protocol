// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "../interfaces/IAsset.sol";
import "../interfaces/IAssetRegistry.sol";
import "../interfaces/IBackingManager.sol";
import "../interfaces/IBasketHandler.sol";
import "../interfaces/IBroker.sol";
import "../interfaces/IDeployer.sol";
import "../interfaces/IDistributor.sol";
import "../interfaces/IFurnace.sol";
import "../interfaces/IRevenueTrader.sol";
import "../interfaces/IRToken.sol";
import "../interfaces/IStRSR.sol";
import "../mixins/Versioned.sol";
import "../plugins/assets/Asset.sol";
import "../plugins/assets/RTokenAsset.sol";
import "./Main.sol";
import "../libraries/String.sol";

/**
 * @title DeployerP1
 * @notice The factory contract that deploys the entire P1 system.
 */
contract DeployerP1 is IDeployer, Versioned {
    using Clones for address;

    string public constant ENS = "reserveprotocol.eth";

    IERC20Metadata public immutable rsr;
    IGnosis public immutable gnosis;
    IAsset public immutable rsrAsset;

    // Implementation contracts for Upgradeability
    Implementations private _implementations;

    // checks: every address in the input is nonzero
    // effects: post, all contract-state values are set
    constructor(
        IERC20Metadata rsr_,
        IGnosis gnosis_,
        IAsset rsrAsset_,
        Implementations memory implementations_
    ) {
        require(
            address(rsr_) != address(0) &&
                address(gnosis_) != address(0) &&
                address(rsrAsset_) != address(0) &&
                address(implementations_.main) != address(0) &&
                address(implementations_.trading.gnosisTrade) != address(0) &&
                address(implementations_.trading.dutchTrade) != address(0) &&
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
        rsrAsset = rsrAsset_;
        _implementations = implementations_;
    }

    function implementations() external view override returns (Implementations memory) {
        return _implementations;
    }

    /// Deploys an instance of the entire system, oriented around some mandate.
    ///
    /// The mandate describes what goals its governors should try to achieve. By succinctly
    /// explaining the RToken’s purpose and what the RToken is intended to do, it provides common
    /// ground for the governors to decide upon priorities and how to weigh tradeoffs.
    ///
    /// Example Mandates:
    ///
    /// - Capital preservation first. Spending power preservation second. Permissionless
    ///     access third.
    /// - Capital preservation above all else. All revenues fund the over-collateralization pool.
    /// - Risk-neutral pursuit of profit for token holders.
    ///     Maximize (gross revenue - payments for over-collateralization and governance).
    /// - This RToken holds only FooCoin, to provide a trade for hedging against its
    ///     possible collapse.
    ///
    /// The mandate may also be a URI to a longer body of text
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
    //   Set up Auth so that `owner` holds the OWNER role and no one else has any
    function deploy(
        string memory name,
        string memory symbol,
        string calldata mandate,
        address owner,
        DeploymentParams memory params
    ) external returns (address) {
        require(owner != address(0) && owner != address(this), "invalid owner");

        // Main - Proxy
        MainP1 main = MainP1(
            address(new ERC1967Proxy(address(_implementations.main), new bytes(0)))
        );

        // Components - Proxies
        IRToken rToken = IRToken(
            address(new ERC1967Proxy(address(_implementations.components.rToken), new bytes(0)))
        );
        Components memory components = Components({
            stRSR: IStRSR(
                address(new ERC1967Proxy(address(_implementations.components.stRSR), new bytes(0)))
            ),
            rToken: rToken,
            assetRegistry: IAssetRegistry(
                address(
                    new ERC1967Proxy(
                        address(_implementations.components.assetRegistry),
                        new bytes(0)
                    )
                )
            ),
            basketHandler: IBasketHandler(
                address(
                    new ERC1967Proxy(
                        address(_implementations.components.basketHandler),
                        new bytes(0)
                    )
                )
            ),
            backingManager: IBackingManager(
                address(
                    new ERC1967Proxy(
                        address(_implementations.components.backingManager),
                        new bytes(0)
                    )
                )
            ),
            distributor: IDistributor(
                address(
                    new ERC1967Proxy(address(_implementations.components.distributor), new bytes(0))
                )
            ),
            rsrTrader: IRevenueTrader(
                address(
                    new ERC1967Proxy(address(_implementations.components.rsrTrader), new bytes(0))
                )
            ),
            rTokenTrader: IRevenueTrader(
                address(
                    new ERC1967Proxy(
                        address(_implementations.components.rTokenTrader),
                        new bytes(0)
                    )
                )
            ),
            furnace: IFurnace(
                address(
                    new ERC1967Proxy(address(_implementations.components.furnace), new bytes(0))
                )
            ),
            broker: IBroker(
                address(new ERC1967Proxy(address(_implementations.components.broker), new bytes(0)))
            )
        });

        // Init Main
        main.init(components, rsr, params.shortFreeze, params.longFreeze);

        // Init Backing Manager
        components.backingManager.init(
            main,
            params.tradingDelay,
            params.backingBuffer,
            params.maxTradeSlippage,
            params.minTradeVolume
        );

        // Init Basket Handler
        components.basketHandler.init(
            main,
            params.warmupPeriod,
            params.reweightable,
            params.enableIssuancePremium
        );

        // Init Revenue Traders
        components.rsrTrader.init(main, rsr, params.maxTradeSlippage, params.minTradeVolume);
        components.rTokenTrader.init(
            main,
            IERC20(address(rToken)),
            params.maxTradeSlippage,
            params.minTradeVolume
        );

        // Init Distributor
        components.distributor.init(main, params.dist);

        // Init Furnace
        components.furnace.init(main, params.rewardRatio);

        components.broker.init(
            main,
            gnosis,
            _implementations.trading.gnosisTrade,
            params.batchAuctionLength,
            _implementations.trading.dutchTrade,
            params.dutchAuctionLength
        );

        // Init StRSR
        {
            string memory stRSRSymbol = string(abi.encodePacked(StringLib.toLower(symbol), "RSR"));
            string memory stRSRName = string(abi.encodePacked(stRSRSymbol, " Token"));
            main.stRSR().init(
                main,
                stRSRName,
                stRSRSymbol,
                params.unstakingDelay,
                params.rewardRatio,
                params.withdrawalLeak
            );
        }

        // Init RToken
        components.rToken.init(
            main,
            name,
            symbol,
            mandate,
            params.issuanceThrottle,
            params.redemptionThrottle
        );

        // Deploy RToken/RSR Assets
        IAsset[] memory assets = new IAsset[](2);
        assets[0] = new RTokenAsset(components.rToken, params.rTokenMaxTradeVolume);
        assets[1] = rsrAsset;

        // Init Asset Registry
        components.assetRegistry.init(main, assets);

        // Transfer Ownership
        main.grantRole(OWNER, owner);
        main.renounceRole(OWNER, address(this));

        emit RTokenCreated(main, components.rToken, components.stRSR, owner, version());
        return (address(components.rToken));
    }

    /// Deploys a new RTokenAsset instance. Not needed during normal deployment flow
    /// @param maxTradeVolume {UoA} The maximum trade volume for the RTokenAsset
    /// @return rTokenAsset The address of the newly deployed RTokenAsset
    function deployRTokenAsset(IRToken rToken, uint192 maxTradeVolume)
        external
        returns (IAsset rTokenAsset)
    {
        rTokenAsset = new RTokenAsset(rToken, maxTradeVolume);
        emit RTokenAssetCreated(rToken, rTokenAsset);
    }
}
