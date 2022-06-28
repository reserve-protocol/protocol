// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/mixins/StateManager.sol";

/**
 * @title ComponentRegistry
 */
abstract contract ComponentRegistry is Initializable, StateManager, IComponentRegistry {
    // solhint-disable-next-line func-name-mixedcase
    function __ComponentRegistry_init(Components memory components_) internal onlyInitializing {
        setBackingManager(components_.backingManager);
        setBasketHandler(components_.basketHandler);
        setRSRTrader(components_.rsrTrader);
        setRTokenTrader(components_.rTokenTrader);
        setAssetRegistry(components_.assetRegistry);
        setDistributor(components_.distributor);
        setFurnace(components_.furnace);
        setBroker(components_.broker);
        setStRSR(components_.stRSR);
        setRToken(components_.rToken);
    }

    // === Components ===

    IRToken public rToken;

    function setRToken(IRToken val) public onlyRole(OWNER) {
        emit RTokenSet(rToken, val);
        rToken = val;
    }

    IStRSR public stRSR;

    function setStRSR(IStRSR val) public onlyRole(OWNER) {
        emit StRSRSet(stRSR, val);
        stRSR = val;
    }

    IAssetRegistry public assetRegistry;

    function setAssetRegistry(IAssetRegistry val) public onlyRole(OWNER) {
        emit AssetRegistrySet(assetRegistry, val);
        assetRegistry = val;
    }

    IBasketHandler public basketHandler;

    function setBasketHandler(IBasketHandler val) public onlyRole(OWNER) {
        emit BasketHandlerSet(basketHandler, val);
        basketHandler = val;
    }

    IBackingManager public backingManager;

    function setBackingManager(IBackingManager val) public onlyRole(OWNER) {
        emit BackingManagerSet(backingManager, val);
        backingManager = val;
    }

    IDistributor public distributor;

    function setDistributor(IDistributor val) public onlyRole(OWNER) {
        emit DistributorSet(distributor, val);
        distributor = val;
    }

    IRevenueTrader public rsrTrader;

    function setRSRTrader(IRevenueTrader val) public onlyRole(OWNER) {
        emit RSRTraderSet(rsrTrader, val);
        rsrTrader = val;
    }

    IRevenueTrader public rTokenTrader;

    function setRTokenTrader(IRevenueTrader val) public onlyRole(OWNER) {
        emit RTokenTraderSet(rTokenTrader, val);
        rTokenTrader = val;
    }

    IFurnace public furnace;

    function setFurnace(IFurnace val) public onlyRole(OWNER) {
        emit FurnaceSet(furnace, val);
        furnace = val;
    }

    IBroker public broker;

    function setBroker(IBroker val) public onlyRole(OWNER) {
        emit BrokerSet(broker, val);
        broker = val;
    }
}
