// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./Auth.sol";

/**
 * @title ComponentRegistry
 */
abstract contract ComponentRegistry is Initializable, Auth, IComponentRegistry {
    // untestable:
    //      `else` branch of `onlyInitializing` (ie. revert) is currently untestable.
    //      This function is only called inside other `init` functions, each of which is wrapped
    //      in an `initializer` modifier, which would fail first.
    // solhint-disable-next-line func-name-mixedcase
    function __ComponentRegistry_init(Components memory components_) internal onlyInitializing {
        _setBackingManager(components_.backingManager);
        _setBasketHandler(components_.basketHandler);
        _setRSRTrader(components_.rsrTrader);
        _setRTokenTrader(components_.rTokenTrader);
        _setAssetRegistry(components_.assetRegistry);
        _setDistributor(components_.distributor);
        _setFurnace(components_.furnace);
        _setBroker(components_.broker);
        _setStRSR(components_.stRSR);
        _setRToken(components_.rToken);
    }

    // === Components ===

    IRToken public rToken;

    function _setRToken(IRToken val) private {
        require(address(val) != address(0), "invalid RToken address");
        emit RTokenSet(rToken, val);
        rToken = val;
    }

    IStRSR public stRSR;

    function _setStRSR(IStRSR val) private {
        require(address(val) != address(0), "invalid StRSR address");
        emit StRSRSet(stRSR, val);
        stRSR = val;
    }

    IAssetRegistry public assetRegistry;

    function _setAssetRegistry(IAssetRegistry val) private {
        require(address(val) != address(0), "invalid AssetRegistry address");
        emit AssetRegistrySet(assetRegistry, val);
        assetRegistry = val;
    }

    IBasketHandler public basketHandler;

    function _setBasketHandler(IBasketHandler val) private {
        require(address(val) != address(0), "invalid BasketHandler address");
        emit BasketHandlerSet(basketHandler, val);
        basketHandler = val;
    }

    IBackingManager public backingManager;

    function _setBackingManager(IBackingManager val) private {
        require(address(val) != address(0), "invalid BackingManager address");
        emit BackingManagerSet(backingManager, val);
        backingManager = val;
    }

    IDistributor public distributor;

    function _setDistributor(IDistributor val) private {
        require(address(val) != address(0), "invalid Distributor address");
        emit DistributorSet(distributor, val);
        distributor = val;
    }

    IRevenueTrader public rsrTrader;

    function _setRSRTrader(IRevenueTrader val) private {
        require(address(val) != address(0), "invalid RSRTrader address");
        emit RSRTraderSet(rsrTrader, val);
        rsrTrader = val;
    }

    IRevenueTrader public rTokenTrader;

    function _setRTokenTrader(IRevenueTrader val) private {
        require(address(val) != address(0), "invalid RTokenTrader address");
        emit RTokenTraderSet(rTokenTrader, val);
        rTokenTrader = val;
    }

    IFurnace public furnace;

    function _setFurnace(IFurnace val) private {
        require(address(val) != address(0), "invalid Furnace address");
        emit FurnaceSet(furnace, val);
        furnace = val;
    }

    IBroker public broker;

    function _setBroker(IBroker val) private {
        require(address(val) != address(0), "invalid Broker address");
        emit BrokerSet(broker, val);
        broker = val;
    }

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[40] private __gap;
}
