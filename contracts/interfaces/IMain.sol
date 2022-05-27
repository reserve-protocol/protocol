// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./IAsset.sol";
import "./IAssetRegistry.sol";
import "./IBackingManager.sol";
import "./IBasketHandler.sol";
import "./IBroker.sol";
import "./IDeployer.sol";
import "./IGnosis.sol";
import "./IFurnace.sol";
import "./IDistributor.sol";
import "./IRToken.sol";
import "./IRevenueTrader.sol";
import "./IStRSR.sol";
import "./ITrading.sol";

/**
 * Main is a central hub that maintains a list of Component contracts.
 *
 * Components:
 *   - perform a specific function
 *   - defer auth to Main
 *   - usually (but not always) contain sizeable state that require a proxy
 */
struct Components {
    // Definitely need proxy
    IRToken rToken;
    IStRSR stRSR;
    IAssetRegistry assetRegistry;
    IBasketHandler basketHandler;
    IBackingManager backingManager;
    IDistributor distributor;
    IFurnace furnace;
    IBroker broker;
    IRevenueTrader rsrTrader;
    IRevenueTrader rTokenTrader;
}

interface IPausable {
    /// Emitted when `unpauseAt` is changed
    /// @param oldUnpauseAt The old value of `unpauseAt`
    /// @param newUnpauseAt The new value of `unpauseAt`
    event UnpauseAtSet(uint32 oldUnpauseAt, uint32 newUnpauseAt);

    /// Emitted when the pauser address is set
    /// @param oldPauser The address of the old pauser
    /// @param newPauser The address of the new pauser
    event OneshotPauserSet(address oldPauser, address newPauser);

    /// Emitted when the oneshot pause duration governance param is changed
    /// @param oldDuration The address of the old pauser
    /// @param newDuration The address of the new pauser
    event OneshotPauseDurationSet(uint32 oldDuration, uint32 newDuration);

    function paused() external view returns (bool);

    function oneshotPauseDuration() external view returns (uint32);
}

interface IComponentRegistry {
    // === Component setters/getters ===

    event RTokenSet(IRToken indexed oldVal, IRToken indexed newVal);

    function rToken() external view returns (IRToken);

    /// @custom:governance
    function setRToken(IRToken rToken) external;

    event StRSRSet(IStRSR indexed oldVal, IStRSR indexed newVal);

    function stRSR() external view returns (IStRSR);

    /// @custom:governance
    function setStRSR(IStRSR stRSR) external;

    event AssetRegistrySet(IAssetRegistry indexed oldVal, IAssetRegistry indexed newVal);

    function assetRegistry() external view returns (IAssetRegistry);

    /// @custom:governance
    function setAssetRegistry(IAssetRegistry val) external;

    event BasketHandlerSet(IBasketHandler indexed oldVal, IBasketHandler indexed newVal);

    function basketHandler() external view returns (IBasketHandler);

    /// @custom:governance
    function setBasketHandler(IBasketHandler val) external;

    event BackingManagerSet(IBackingManager indexed oldVal, IBackingManager indexed newVal);

    function backingManager() external view returns (IBackingManager);

    /// @custom:governance
    function setBackingManager(IBackingManager val) external;

    event DistributorSet(IDistributor indexed oldVal, IDistributor indexed newVal);

    function distributor() external view returns (IDistributor);

    /// @custom:governance
    function setDistributor(IDistributor val) external;

    event RSRTraderSet(IRevenueTrader indexed oldVal, IRevenueTrader indexed newVal);

    function rsrTrader() external view returns (IRevenueTrader);

    /// @custom:governance
    function setRSRTrader(IRevenueTrader rsrTrader) external;

    event RTokenTraderSet(IRevenueTrader indexed oldVal, IRevenueTrader indexed newVal);

    function rTokenTrader() external view returns (IRevenueTrader);

    /// @custom:governance
    function setRTokenTrader(IRevenueTrader rTokenTrader) external;

    event FurnaceSet(IFurnace indexed oldVal, IFurnace indexed newVal);

    function furnace() external view returns (IFurnace);

    /// @custom:governance
    function setFurnace(IFurnace furnace) external;

    event BrokerSet(IBroker indexed oldVal, IBroker indexed newVal);

    function broker() external view returns (IBroker);

    /// @custom:governance
    function setBroker(IBroker broker) external;
}

/**
 * @title IMain
 * @notice The central hub for the entire system. Maintains components and an owner singleton role
 */
interface IMain is IComponentRegistry, IPausable {
    function poke() external; // not used in p1

    // === Initialization ===

    event MainInitialized();

    function init(
        Components memory components,
        IERC20 rsr_,
        uint32 oneshotPauseDuration_
    ) external;

    function rsr() external view returns (IERC20);

    function owner() external view returns (address);
}

interface TestIMain is IMain {
    function pause() external;

    function unpause() external;

    function isComponent(address componentAddr) external view returns (bool);

    function oneshotPauser() external view returns (address);

    function setOneshotPauser(address pauser_) external;

    function setOneshotPauseDuration(uint32) external;

    function renounceOwnership() external;

    function renouncePausership() external;

    function transferOwnership(address newOwner) external;
}
