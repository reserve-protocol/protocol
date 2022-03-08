// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/interfaces/IMain.sol";

/** Contract mixin providing:
 * - The paused flag
 * - A pauser role, modifiable by pauser or owner
 * - Pause and unpause commands, to allow either pauser or owner to set the paused flag.
 * - The `notPaused` modifier.
 */
contract Pausable is Ownable, IPausable {
    address private _pauser;
    bool public paused;

    constructor() {
        _pauser = _msgSender();
        paused = true;
    }

    modifier notPaused() {
        require(!paused, "paused");
        _;
    }

    function pause() external {
        require(_msgSender() == _pauser || _msgSender() == owner(), "only pauser or owner");
        emit PausedSet(paused, true);
        paused = true;
    }

    function unpause() external {
        require(_msgSender() == _pauser || _msgSender() == owner(), "only pauser or owner");
        emit PausedSet(paused, false);
        paused = false;
    }

    function pauser() external view returns (address) {
        return _pauser;
    }

    function setPauser(address pauser_) external {
        require(_msgSender() == _pauser || _msgSender() == owner(), "only pauser or owner");
        emit PauserSet(_pauser, pauser_);
        _pauser = pauser_;
    }
}

/**
 * @title Main
 * @notice Collects all mixins.
 */
// solhint-disable max-states-count
contract MainP0 is Pausable, IMain {
    using FixLib for Fix;
    using EnumerableSet for EnumerableSet.AddressSet;

    // Already initialized?
    bool private initialized;
    EnumerableSet.AddressSet private components;

    function poke() external {
        // We _think_ these are totally order-independent.
        require(!paused, "paused");
        backingManager.grantAllowances();
        basketHandler.ensureBasket();
        assetRegistry.forceUpdates();
        furnace.melt();
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

        setIssuer(args.core.issuer);
        issuer.initComponent(this, args);

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

        setDistributor(args.core.distributor);
        distributor.initComponent(this, args);

        setFurnace(args.periphery.furnace);

        setMarket(args.periphery.market);

        setRSR(args.rsr);

        setStRSR(args.core.stRSR);
        stRSR.initComponent(this, args);

        setRToken(args.core.rToken);
        rToken.initComponent(this, args);

        emit Initialized();
    }

    // === Registered Contracts ===

    IRToken public rToken;

    function setRToken(IRToken val) public onlyOwner {
        emit RTokenSet(rToken, val);
        components.remove(address(rToken));
        components.add(address(val));
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

    IIssuer public issuer;

    function setIssuer(IIssuer val) public onlyOwner {
        emit IssuerSet(issuer, val);
        components.remove(address(issuer));
        components.add(address(val));
        issuer = val;
    }

    IDistributor public distributor;

    function setDistributor(IDistributor val) public onlyOwner {
        emit DistributorSet(distributor, val);
        components.remove(address(distributor));
        components.add(address(val));
        distributor = val;
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

    IFurnace public furnace;

    function setFurnace(IFurnace val) public onlyOwner {
        emit FurnaceSet(furnace, val);
        furnace = val;
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
}
