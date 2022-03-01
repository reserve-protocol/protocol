// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/p0/Settings.sol";

import "contracts/p0/interfaces/IMain.sol"; //
import "contracts/Pausable.sol";

/**
 * @title Main
 * @notice Collects all mixins.
 */
contract MainP0 is Ownable, Pausable, IMain {
    using FixLib for Fix;
    using EnumerableSet for EnumerableSet.AddressSet;

    // Already initialized?
    bool private initialized;
    EnumerableSet.AddressSet private components;

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

    // === Registered Contracts ===
    IRTokenIssuer public rTokenIssuer;

    function setRTokenIssuer(IRTokenIssuer val) public onlyOwner {
        emit RTokenIssuerSet(rTokenIssuer, val);
        components.remove(address(rTokenIssuer));
        components.add(address(val));
        rTokenIssuer = val;
    }

    IBackingManager public backingManager;

    function setBackingManager(IBackingManager val) public onlyOwner {
        emit BackingManagerSet(backingManager, val);
        components.remove(address(backingManager));
        components.add(address(val));
        backingManager = val;
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

    IBasketHandler public basketHandler;

    function setBasketHandler(IBasketHandler val) public onlyOwner {
        emit BasketHandlerSet(basketHandler, val);
        components.remove(address(basketHandler));
        components.add(address(val));
        basketHandler = val;
    }

    IAssetRegistry public assetRegistry;

    function setAssetRegistry(IAssetRegistry val) public onlyOwner {
        emit AssetRegistrySet(assetRegistry, val);
        components.remove(address(assetRegistry));
        components.add(address(val));
        assetRegistry = val;
    }

    IRevenueDistributor public revenueDistributor;

    function setRevenueDistributor(IRevenueDistributor val) public onlyOwner {
        emit RevenueDistributorSet(revenueDistributor, val);
        components.remove(address(revenueDistributor));
        components.add(address(val));
        revenueDistributor = val;
    }

    ISettings public settings;

    function setSettings(ISettings val) public onlyOwner {
        emit SettingsSet(settings, val);
        components.remove(address(settings));
        components.add(address(val));
        settings = val;
    }

    IStRSR public stRSR;

    function setStRSR(IStRSR val) public onlyOwner {
        emit StRSRSet(stRSR, val);
        components.remove(address(stRSR));
        components.add(address(val));
        stRSR = val;
    }

    IFurnace public revenueFurnace;

    function setRevenueFurnace(IFurnace val) public onlyOwner {
        emit RevenueFurnaceSet(revenueFurnace, val);
        components.remove(address(revenueFurnace));
        components.add(address(val));
        revenueFurnace = val;
    }

    IRToken public rToken;

    function setRToken(IRToken val) public onlyOwner {
        emit RTokenSet(rToken, val);
        rToken = val;
    }

    IERC20Metadata public rsr;

    function setRSR(IERC20Metadata val) public onlyOwner {
        emit RSRSet(rsr, val);
        rsr = val;
    }

    IMarket public market;

    function setMarket(IMarket val) public onlyOwner {
        emit MarketSet(market, val);
        market = val;
    }

    /// Initializer
    function init(ConstructorArgs calldata args) public onlyOwner {
        require(!initialized, "Already initialized");
        initialized = true;

        setRTokenIssuer(args.rTokenIssuer);
        rTokenIssuer.initComponent(this, args);

        setBackingManager(args.backingManager);
        backingManager.initComponent(this, args);

        setBasketHandler(args.basketHandler);
        basketHandler.initComponent(this, args);

        setRSRTrader(args.rsrTrader);
        rsrTrader.initComponent(this, args);

        setRTokenTrader(args.rTokenTrader);
        rTokenTrader.initComponent(this, args);

        setAssetRegistry(args.assetRegistry);
        assetRegistry.initComponent(this, args);

        setRevenueDistributor(args.revenueDistributor);
        revenueDistributor.initComponent(this, args);

        setSettings(args.settings);
        settings.initComponent(this, args);

        setRevenueFurnace(args.furnace);

        setMarket(args.market);

        setRSR(args.rsr);

        setStRSR(args.stRSR);
        stRSR.initComponent(this, args);

        setRToken(args.rToken);
        // TODO: make Component

        for (uint256 i = 0; i < args.claimAdapters.length; i++) {
            _claimAdapters.add(address(args.claimAdapters[i]));
        }

        emit Initialized();
    }

    function hasComponent(address addr) external view returns (bool) {
        return components.contains(addr);
    }

    function owner() public view override(IMain, Ownable) returns (address) {
        return Ownable.owner();
    }
}
