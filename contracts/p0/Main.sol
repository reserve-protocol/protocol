// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
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

    // Already initialized?
    bool private initialized;

    // === Registered Contracts ===
    IRTokenIssuer public rTokenIssuer;

    function setRTokenIssuer(IRTokenIssuer val) external onlyOwner {
        emit RTokenIssuerSet(rTokenIssuer, val);
        rTokenIssuer = val;
    }

    IRewardClaimer public rewardClaimer;

    function setRewardClaimer(IRewardClaimer val) external onlyOwner {
        emit RewardClaimerSet(rewardClaimer, val);
        rewardClaimer = val;
    }

    IAuctioneer public auctioneer;

    function setAuctioneer(IAuctioneer val) external onlyOwner {
        emit AuctioneerSet(auctioneer, val);
        auctioneer = val;
    }

    IBasketHandler public basketHandler;

    function setBasketHandler(IBasketHandler val) external onlyOwner {
        emit BasketHandlerSet(basketHandler, val);
        basketHandler = val;
    }

    IAssetRegistry public assetRegistry;

    function setAssetRegistry(IAssetRegistry val) external onlyOwner {
        emit AssetRegistrySet(assetRegistry, val);
        assetRegistry = val;
    }

    IRevenueDistributor public revenueDistributor;

    function setRevenueDistributor(IRevenueDistributor val) external onlyOwner {
        emit RevenueDistributorSet(revenueDistributor, val);
        revenueDistributor = val;
    }

    ISettings public settings;

    function setSettings(ISettings val) external onlyOwner {
        emit SettingsSet(settings, val);
        settings = val;
    }

    IStRSR public stRSR;

    function setStRSR(IStRSR val) external onlyOwner {
        emit StRSRSet(stRSR, val);
        stRSR = val;
    }

    IFurnace public revenueFurnace;

    function setRevenueFurnace(IFurnace val) external onlyOwner {
        emit RevenueFurnaceSet(revenueFurnace, val);
        revenueFurnace = val;
    }

    IRToken public rToken;

    function setRToken(IRToken val) external onlyOwner {
        emit RTokenSet(rToken, val);
        rToken = val;
    }

    IERC20Metadata public rsr;

    function setRSR(IERC20Metadata val) external onlyOwner {
        emit RSRSet(rsr, val);
        rsr = val;
    }

    IMarket public market;

    function setMarket(IMarket val) external onlyOwner {
        emit MarketSet(market, val);
        market = val;
    }

    /// Initializer
    function init(ConstructorArgs calldata args) public onlyOwner {
        require(!initialized, "Already initialized");
        initialized = true;

        emit RTokenIssuerSet(rTokenIssuer, args.rTokenIssuer);
        rTokenIssuer = args.rTokenIssuer;
        rTokenIssuer.initComponent(this, args);

        emit RewardClaimerSet(rewardClaimer, args.rewardClaimer);
        rewardClaimer = args.rewardClaimer;
        rewardClaimer.initComponent(this, args);

        emit AuctioneerSet(auctioneer, args.auctioneer);
        auctioneer = args.auctioneer;
        auctioneer.initComponent(this, args);

        emit BasketHandlerSet(basketHandler, args.basketHandler);
        basketHandler = args.basketHandler;
        basketHandler.initComponent(this, args);

        emit AssetRegistrySet(assetRegistry, args.assetRegistry);
        assetRegistry = args.assetRegistry;
        assetRegistry.initComponent(this, args);

        emit RevenueDistributorSet(revenueDistributor, args.revenueDistributor);
        revenueDistributor = args.revenueDistributor;
        revenueDistributor.initComponent(this, args);

        emit SettingsSet(settings, args.settings);
        settings = args.settings;
        settings.initComponent(this, args);

        emit RevenueFurnaceSet(revenueFurnace, args.furnace);
        revenueFurnace = args.furnace;
        // initComponent if revenueFurnace becomes a Component

        emit MarketSet(market, args.market);
        market = args.market;
        // initComponent if Market becomes a Component

        emit RSRSet(rsr, args.rsr);
        rsr = args.rsr;

        emit StRSRSet(stRSR, args.stRSR);
        stRSR = args.stRSR;
        // TODO: initComponent

        emit RTokenSet(rToken, args.rToken);
        rToken = args.rToken;
        // TODO: initComponent

        emit Initialized();
    }

    function owner() public view override(IMain, Ownable) returns (address) {
        return Ownable.owner();
    }
}
