// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/mixins/Auth.sol";

/**
 * @title ComponentRegistry
 */
abstract contract ComponentRegistry is Initializable, Auth, IComponentRegistry {
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
        emit RTokenSet(rToken, val);
        rToken = val;
    }

    IStRSR public stRSR;

    function _setStRSR(IStRSR val) private {
        emit StRSRSet(stRSR, val);
        stRSR = val;
    }

    IAssetRegistry public assetRegistry;

    function _setAssetRegistry(IAssetRegistry val) private {
        emit AssetRegistrySet(assetRegistry, val);
        assetRegistry = val;
    }

    IBasketHandler public basketHandler;

    function _setBasketHandler(IBasketHandler val) private {
        emit BasketHandlerSet(basketHandler, val);
        basketHandler = val;
    }

    IBackingManager public backingManager;

    function _setBackingManager(IBackingManager val) private {
        emit BackingManagerSet(backingManager, val);
        backingManager = val;
    }

    IDistributor public distributor;

    function _setDistributor(IDistributor val) private {
        emit DistributorSet(distributor, val);
        distributor = val;
    }

    IRevenueTrader public rsrTrader;

    function _setRSRTrader(IRevenueTrader val) private {
        emit RSRTraderSet(rsrTrader, val);
        rsrTrader = val;
    }

    IRevenueTrader public rTokenTrader;

    function _setRTokenTrader(IRevenueTrader val) private {
        emit RTokenTraderSet(rTokenTrader, val);
        rTokenTrader = val;
    }

    IFurnace public furnace;

    function _setFurnace(IFurnace val) private {
        emit FurnaceSet(furnace, val);
        furnace = val;
    }

    IBroker public broker;

    function _setBroker(IBroker val) private {
        emit BrokerSet(broker, val);
        broker = val;
    }
}
