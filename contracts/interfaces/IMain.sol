// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import "./IAsset.sol";
import "./IAssetRegistry.sol";
import "./IBackingManager.sol";
import "./IBasketHandler.sol";
import "./IClaimAdapter.sol";
import "./IDeployer.sol";
import "./IFurnace.sol";
import "./IMarket.sol";
import "./IDistributor.sol";
import "./IRToken.sol";
import "./IIssuer.sol";
import "./IRevenueTrader.sol";
import "./IStRSR.sol";
import "./ITrader.sol";

/// Configuration of an entire system instance
struct ConstructorArgs {
    DeploymentParams params;
    Core core;
    Periphery periphery;
    IERC20 rsr;
}

/// The spokes of our hub-and-spoke component model centered around Main
/// One single security domain
/// Upgradeable
struct Core {
    IRToken rToken; // not actually a component, yet
    IStRSR stRSR;
    IAssetRegistry assetRegistry;
    IBasketHandler basketHandler;
    IBackingManager backingManager;
    IIssuer issuer;
    IDistributor distributor;
    IRevenueTrader rsrTrader;
    IRevenueTrader rTokenTrader;
}

/// INVARIANT: Unaware of Main
/// Not upgradeable, only swappable
struct Periphery {
    IMarket market;
    IFurnace furnace;
    IClaimAdapter[] claimAdapters;
    IAsset[] assets;
}

interface IPausable {
    /// Emitted when the paused status is set
    /// @param oldPaused The old value of the paused state
    /// @param newPaused The new value of the paused state
    event PausedSet(bool oldPaused, bool newPaused);

    /// Emitted when the pauser address is set
    /// @param oldPauser The address of the old pauser
    /// @param newPauser The address of the new pauser
    event PauserSet(address oldPauser, address newPauser);

    function pause() external;

    function unpause() external;

    function paused() external returns (bool);

    function pauser() external view returns (address);

    function setPauser(address pauser_) external;
}

/**
 * @title IMain
 * @notice The central coordinator for the entire system, as well as the external interface.
 * @dev The p0-specific IMain
 */
interface IMain is IPausable {
    /// Call all collective state keepers
    function poke() external;

    // ---

    event RTokenSet(IRToken indexed oldVal, IRToken indexed newVal);

    function rToken() external view returns (IRToken);

    function setRToken(IRToken rToken) external;

    event StRSRSet(IStRSR indexed oldVal, IStRSR indexed newVal);

    function stRSR() external view returns (IStRSR);

    function setStRSR(IStRSR stRSR) external;

    event AssetRegistrySet(IAssetRegistry indexed oldVal, IAssetRegistry indexed newVal);

    function assetRegistry() external view returns (IAssetRegistry);

    function setAssetRegistry(IAssetRegistry val) external;

    event BasketHandlerSet(IBasketHandler indexed oldVal, IBasketHandler indexed newVal);

    function basketHandler() external view returns (IBasketHandler);

    function setBasketHandler(IBasketHandler val) external;

    event BackingManagerSet(IBackingManager indexed oldVal, IBackingManager indexed newVal);

    function backingManager() external view returns (IBackingManager);

    function setBackingManager(IBackingManager val) external;

    event IssuerSet(IIssuer indexed oldVal, IIssuer indexed newVal);

    function issuer() external view returns (IIssuer);

    function setIssuer(IIssuer val) external;

    event DistributorSet(IDistributor indexed oldVal, IDistributor indexed newVal);

    function distributor() external view returns (IDistributor);

    function setDistributor(IDistributor val) external;

    event RSRTraderSet(IRevenueTrader indexed oldVal, IRevenueTrader indexed newVal);

    function rsrTrader() external view returns (IRevenueTrader);

    function setRSRTrader(IRevenueTrader rsrTrader) external;

    event RTokenTraderSet(IRevenueTrader indexed oldVal, IRevenueTrader indexed newVal);

    function rTokenTrader() external view returns (IRevenueTrader);

    function setRTokenTrader(IRevenueTrader rTokenTrader) external;

    event FurnaceSet(IFurnace indexed oldVal, IFurnace indexed newVal);

    function furnace() external view returns (IFurnace);

    function setFurnace(IFurnace furnace) external;

    event MarketSet(IMarket indexed oldVal, IMarket indexed newVal);

    function market() external view returns (IMarket);

    function setMarket(IMarket market) external;

    event RSRSet(IERC20 indexed oldVal, IERC20 indexed newVal);

    function rsr() external view returns (IERC20);

    function setRSR(IERC20 rsr) external;

    // ---
    event Initialized();

    function init(ConstructorArgs calldata args) external;

    function hasComponent(address addr) external view returns (bool);

    function owner() external view returns (address);

    // --
    /// Emitted whenever a claim adapter is added by governance
    event ClaimAdapterAdded(IClaimAdapter indexed adapter);
    /// Emitted whenever a claim adapter is removed by governance
    event ClaimAdapterRemoved(IClaimAdapter indexed adapter);

    function addClaimAdapter(IClaimAdapter claimAdapter) external;

    function removeClaimAdapter(IClaimAdapter claimAdapter) external;

    function isTrustedClaimAdapter(IClaimAdapter claimAdapter) external view returns (bool);

    function claimAdapters() external view returns (IClaimAdapter[] memory adapters);
}
