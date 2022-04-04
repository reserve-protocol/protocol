// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/interfaces/IMain.sol";

/// Only Main is Pausable
abstract contract Pausable is OwnableUpgradeable, IPausable {
    address private _pauser;
    bool public paused;

    // solhint-disable-next-line func-name-mixedcase
    function __Pausable_init() internal onlyInitializing {
        __Ownable_init();
        _pauser = _msgSender();
        paused = true;
    }

    modifier notPaused() {
        require(!paused, "paused");
        _;
    }

    function pause() public {
        require(_msgSender() == _pauser || _msgSender() == owner(), "only pauser or owner");
        emit PausedSet(paused, true);
        paused = true;
    }

    function unpause() public {
        require(_msgSender() == _pauser || _msgSender() == owner(), "only pauser or owner");
        emit PausedSet(paused, false);
        paused = false;
    }

    function pauser() public view returns (address) {
        return _pauser;
    }

    function setPauser(address pauser_) public {
        require(_msgSender() == _pauser || _msgSender() == owner(), "only pauser or owner");
        require(pauser_ != address(0), "use renouncePauser");
        emit PauserSet(_pauser, pauser_);
        _pauser = pauser_;
    }

    function renouncePausership() external {
        require(_msgSender() == _pauser || _msgSender() == owner(), "only pauser or owner");
        emit PauserSet(_pauser, address(0));
        _pauser = address(0);
    }
}

/**
 * @title Main
 * @notice Collects all mixins.
 */
// solhint-disable max-states-count
contract MainP0 is Initializable, ContextUpgradeable, Pausable, IMain {
    using FixLib for int192;

    function poke() external virtual notPaused {
        // We think these are totally order-independent.
        basketHandler.ensureBasket();
        furnace.melt();
        rsrTrader.settleTrades();
        rTokenTrader.settleTrades();
        backingManager.settleTrades();
        stRSR.payoutRewards();
    }

    function owner() public view override(IMain, OwnableUpgradeable) returns (address) {
        return OwnableUpgradeable.owner();
    }

    /// Initializer
    function init(
        Components memory components,
        IERC20 rsr_,
        address owner_
    ) public virtual initializer {
        __Pausable_init();

        setBackingManager(components.backingManager);
        setBasketHandler(components.basketHandler);
        setRSRTrader(components.rsrTrader);
        setRTokenTrader(components.rTokenTrader);
        setAssetRegistry(components.assetRegistry);
        setDistributor(components.distributor);
        setFurnace(components.furnace);
        setBroker(components.broker);
        setStRSR(components.stRSR);
        setRToken(components.rToken);
        setRSR(rsr_);

        // Roles
        setPauser(owner_);
        transferOwnership(owner_);

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
        stRSR = val;
    }

    IAssetRegistry public assetRegistry;

    function setAssetRegistry(IAssetRegistry val) public onlyOwner {
        emit AssetRegistrySet(assetRegistry, val);
        assetRegistry = val;
    }

    IBasketHandler public basketHandler;

    function setBasketHandler(IBasketHandler val) public onlyOwner {
        emit BasketHandlerSet(basketHandler, val);
        basketHandler = val;
    }

    IBackingManager public backingManager;

    function setBackingManager(IBackingManager val) public onlyOwner {
        emit BackingManagerSet(backingManager, val);
        backingManager = val;
    }

    IDistributor public distributor;

    function setDistributor(IDistributor val) public onlyOwner {
        emit DistributorSet(distributor, val);
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

    IFurnace public furnace;

    function setFurnace(IFurnace val) public onlyOwner {
        emit FurnaceSet(furnace, val);
        furnace = val;
    }

    IBroker public broker;

    function setBroker(IBroker val) public onlyOwner {
        emit BrokerSet(broker, val);
        broker = val;
    }

    // === Non-components ===

    IERC20 public rsr;

    function setRSR(IERC20 val) public onlyOwner {
        emit RSRSet(rsr, val);
        rsr = val;
    }
}
