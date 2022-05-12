// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "contracts/interfaces/IMain.sol";

/**
 * @title ComponentRegistry
 * @notice Abstract class for Main contracts to use for managing their components.
 */
abstract contract ComponentRegistry is Initializable, OwnableUpgradeable, IComponentRegistry {
    using EnumerableSet for EnumerableSet.AddressSet;

    EnumerableSet.AddressSet private components;

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

    modifier onlyComponent() {
        require(components.contains(_msgSender()), "components only");
        _;
    }

    // === Components ===

    IRToken public rToken;

    function setRToken(IRToken val) public onlyOwner {
        components.remove(address(rToken));
        components.add(address(val));
        emit RTokenSet(rToken, val);
        rToken = val;
    }

    IStRSR public stRSR;

    function setStRSR(IStRSR val) public onlyOwner {
        components.remove(address(stRSR));
        components.add(address(val));
        emit StRSRSet(stRSR, val);
        stRSR = val;
    }

    IAssetRegistry public assetRegistry;

    function setAssetRegistry(IAssetRegistry val) public onlyOwner {
        components.remove(address(assetRegistry));
        components.add(address(val));
        emit AssetRegistrySet(assetRegistry, val);
        assetRegistry = val;
    }

    IBasketHandler public basketHandler;

    function setBasketHandler(IBasketHandler val) public onlyOwner {
        components.remove(address(basketHandler));
        components.add(address(val));
        emit BasketHandlerSet(basketHandler, val);
        basketHandler = val;
    }

    IBackingManager public backingManager;

    function setBackingManager(IBackingManager val) public onlyOwner {
        components.remove(address(backingManager));
        components.add(address(val));
        emit BackingManagerSet(backingManager, val);
        backingManager = val;
    }

    IDistributor public distributor;

    function setDistributor(IDistributor val) public onlyOwner {
        components.remove(address(distributor));
        components.add(address(val));
        emit DistributorSet(distributor, val);
        distributor = val;
    }

    IRevenueTrader public rsrTrader;

    function setRSRTrader(IRevenueTrader val) public onlyOwner {
        components.remove(address(rsrTrader));
        components.add(address(val));
        emit RSRTraderSet(rsrTrader, val);
        rsrTrader = val;
    }

    IRevenueTrader public rTokenTrader;

    function setRTokenTrader(IRevenueTrader val) public onlyOwner {
        components.remove(address(rTokenTrader));
        components.add(address(val));
        emit RTokenTraderSet(rTokenTrader, val);
        rTokenTrader = val;
    }

    IFurnace public furnace;

    function setFurnace(IFurnace val) public onlyOwner {
        components.remove(address(furnace));
        components.add(address(val));
        emit FurnaceSet(furnace, val);
        furnace = val;
    }

    IBroker public broker;

    function setBroker(IBroker val) public onlyOwner {
        components.remove(address(broker));
        components.add(address(val));
        emit BrokerSet(broker, val);
        broker = val;
    }
}
