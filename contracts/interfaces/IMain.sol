// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
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
import "./IPausable.sol";
import "./IRevenueDistributor.sol";
import "./IRToken.sol";
import "./IRTokenIssuer.sol";
import "./IRevenueTrader.sol";
import "./IStRSR.sol";
import "./ITrader.sol";

/// Configuration of an entire system instance
struct ConstructorArgs {
    DeploymentParams params;
    Core core;
    Periphery periphery;
    IERC20Metadata rsr;
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
    IRTokenIssuer rTokenIssuer;
    IRevenueDistributor revenueDistributor;
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

    event RTokenIssuerSet(IRTokenIssuer indexed oldVal, IRTokenIssuer indexed newVal);

    function rTokenIssuer() external view returns (IRTokenIssuer);

    function setRTokenIssuer(IRTokenIssuer val) external;

    event RevenueDistributorSet(
        IRevenueDistributor indexed oldVal,
        IRevenueDistributor indexed newVal
    );

    function revenueDistributor() external view returns (IRevenueDistributor);

    function setRevenueDistributor(IRevenueDistributor val) external;

    event RSRTraderSet(IRevenueTrader indexed oldVal, IRevenueTrader indexed newVal);

    function rsrTrader() external view returns (IRevenueTrader);

    function setRSRTrader(IRevenueTrader rsrTrader) external;

    event RTokenTraderSet(IRevenueTrader indexed oldVal, IRevenueTrader indexed newVal);

    function rTokenTrader() external view returns (IRevenueTrader);

    function setRTokenTrader(IRevenueTrader rTokenTrader) external;

    event RevenueFurnaceSet(IFurnace indexed oldVal, IFurnace indexed newVal);

    function revenueFurnace() external view returns (IFurnace);

    function setRevenueFurnace(IFurnace furnace) external;

    event MarketSet(IMarket indexed oldVal, IMarket indexed newVal);

    function market() external view returns (IMarket);

    function setMarket(IMarket market) external;

    event RSRSet(IERC20Metadata indexed oldVal, IERC20Metadata indexed newVal);

    function rsr() external view returns (IERC20Metadata);

    function setRSR(IERC20Metadata rsr) external;

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
