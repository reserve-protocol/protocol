// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/p0/Pausable.sol";

/**
 * @title Main
 * @notice Collects all mixins.
 */
// solhint-disable max-states-count
contract MainP0 is Ownable, Pausable, IMain {
    using FixLib for Fix;
    using EnumerableSet for EnumerableSet.AddressSet;

    // Already initialized?
    bool private initialized;
    EnumerableSet.AddressSet private components;

    function poke() external {
        // We _think_ these are totally order-independent.
        require(!paused, "paused");
        backingManager.grantAllowances();
        basketHandler.ensureValidBasket();
        revenueFurnace.melt();
        rsrTrader.closeDueAuctions();
        rTokenTrader.closeDueAuctions();
        backingManager.closeDueAuctions();
        stRSR.payoutRewards();
    }

    function hasComponent(address addr) external view returns (bool) {
        return components.contains(addr);
    }

    function owner() public view override(IMain, Ownable) returns (address) {
        return Ownable.owner();
    }

    /// Initializer
    function init(ConstructorArgs calldata args) public onlyOwner {
        require(!initialized, "Already initialized");
        initialized = true;

        setRTokenIssuer(args.core.rTokenIssuer);
        rTokenIssuer.initComponent(this, args);

        setBackingManager(args.core.backingManager);
        backingManager.initComponent(this, args);

        setBasketHandler(args.core.basketHandler);
        basketHandler.initComponent(this, args);

        setRSRTrader(args.core.rsrTrader);
        rsrTrader.initComponent(this, args);

        setRTokenTrader(args.core.rTokenTrader);
        rTokenTrader.initComponent(this, args);

        setAssetRegistry(args.core.assetRegistry);
        assetRegistry.initComponent(this, args);

        setRevenueDistributor(args.core.revenueDistributor);
        revenueDistributor.initComponent(this, args);

        setRevenueFurnace(args.periphery.furnace);

        setMarket(args.periphery.market);

        setRSR(args.rsr);

        setStRSR(args.core.stRSR);
        stRSR.initComponent(this, args);

        setRToken(args.core.rToken);
        // TODO: make Component

        for (uint256 i = 0; i < args.periphery.claimAdapters.length; i++) {
            _claimAdapters.add(address(args.periphery.claimAdapters[i]));
        }

        emit Initialized();
    }

    // === Registered Contracts ===

    IRToken public rToken;

    function setRToken(IRToken val) public onlyOwner {
        emit RTokenSet(rToken, val);
        rToken = val;
    }

    IStRSR public stRSR;

    function setStRSR(IStRSR val) public onlyOwner {
        emit StRSRSet(stRSR, val);
        components.remove(address(stRSR));
        components.add(address(val));
        stRSR = val;
    }

    IAssetRegistry public assetRegistry;

    function setAssetRegistry(IAssetRegistry val) public onlyOwner {
        emit AssetRegistrySet(assetRegistry, val);
        components.remove(address(assetRegistry));
        components.add(address(val));
        assetRegistry = val;
    }

    IBasketHandler public basketHandler;

    function setBasketHandler(IBasketHandler val) public onlyOwner {
        emit BasketHandlerSet(basketHandler, val);
        components.remove(address(basketHandler));
        components.add(address(val));
        basketHandler = val;
    }

    IBackingManager public backingManager;

    function setBackingManager(IBackingManager val) public onlyOwner {
        emit BackingManagerSet(backingManager, val);
        components.remove(address(backingManager));
        components.add(address(val));
        backingManager = val;
    }

    IRTokenIssuer public rTokenIssuer;

    function setRTokenIssuer(IRTokenIssuer val) public onlyOwner {
        emit RTokenIssuerSet(rTokenIssuer, val);
        components.remove(address(rTokenIssuer));
        components.add(address(val));
        rTokenIssuer = val;
    }

    IRevenueDistributor public revenueDistributor;

    function setRevenueDistributor(IRevenueDistributor val) public onlyOwner {
        emit RevenueDistributorSet(revenueDistributor, val);
        components.remove(address(revenueDistributor));
        components.add(address(val));
        revenueDistributor = val;
    }

    IRevenueTrader public rsrTrader;

    function setRSRTrader(IRevenueTrader val) public onlyOwner {
        emit RSRTraderSet(rsrTrader, val);
        rsrTrader = val;
    }

    IRevenueTrader public rTokenTrader;

    function setRTokenTrader(IRevenueTrader val) public onlyOwner {
        emit RTokenTraderSet(rTokenTrader, val);
        rTokenTrader = val;
    }

    // === Non-components ===

    IFurnace public revenueFurnace;

    function setRevenueFurnace(IFurnace val) public onlyOwner {
        emit RevenueFurnaceSet(revenueFurnace, val);
        revenueFurnace = val;
    }

    IERC20 public rsr;

    function setRSR(IERC20 val) public onlyOwner {
        emit RSRSet(rsr, val);
        rsr = val;
    }

    IMarket public market;

    function setMarket(IMarket val) public onlyOwner {
        emit MarketSet(market, val);
        market = val;
    }

    // === Claim Adapter Registry ===
    EnumerableSet.AddressSet private _claimAdapters;

    function addClaimAdapter(IClaimAdapter claimAdapter) external override onlyOwner {
        emit ClaimAdapterAdded(claimAdapter);
        _claimAdapters.add(address(claimAdapter));
    }

    function removeClaimAdapter(IClaimAdapter claimAdapter) external override onlyOwner {
        emit ClaimAdapterRemoved(claimAdapter);
        _claimAdapters.remove(address(claimAdapter));
    }

    function isTrustedClaimAdapter(IClaimAdapter claimAdapter) public view override returns (bool) {
        return _claimAdapters.contains(address(claimAdapter));
    }

    function claimAdapters() public view override returns (IClaimAdapter[] memory adapters) {
        adapters = new IClaimAdapter[](_claimAdapters.length());
        for (uint256 i = 0; i < _claimAdapters.length(); i++) {
            adapters[i] = IClaimAdapter(_claimAdapters.at(i));
        }
    }
}
