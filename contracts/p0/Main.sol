// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/p0/main/SettingsHandler.sol";
import "contracts/p0/main/Mixin.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/interfaces/IMarket.sol";
import "contracts/p0/interfaces/IRTokenIssuer.sol";
import "contracts/Pausable.sol";

/**
 * @title Main
 * @notice Collects all mixins.
 */
contract MainP0 is Ownable, Pausable, Mixin, SettingsHandlerP0, IMain {
    using FixLib for Fix;

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

    /// Initializer
    function init(ConstructorArgs calldata args)
        public
        virtual
        override(IMixin, Mixin, SettingsHandlerP0)
        onlyOwner
    {
        super.init(args);

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
    }

    function owner() public view virtual override(IMain, Ownable) returns (address) {
        return Ownable.owner();
    }
}
