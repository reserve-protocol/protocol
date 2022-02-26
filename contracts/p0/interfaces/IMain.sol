// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import "./IAsset.sol";
import "./IAssetRegistry.sol";
import "./IAuctioneer.sol";
import "./IBasketHandler.sol";
import "./IClaimAdapter.sol";
import "./IFurnace.sol";
import "./IMarket.sol";
import "./IRewardClaimer.sol";
import "./IRevenueDistributor.sol";
import "./IRToken.sol";
import "./IRTokenIssuer.sol";
import "./ISettings.sol";
import "./IStRSR.sol";
import "./ITrader.sol";

/// Configuration of the system
struct Config {
    // Time (seconds)
    uint256 rewardStart; // the timestamp of the very first reward claim event
    uint256 rewardPeriod; // the duration between reward-claim events
    uint256 auctionPeriod; // the length of an auction
    uint256 stRSRPayPeriod; // the duration between stRSR payment events
    uint256 stRSRWithdrawalDelay; // the "thawing time" of staked RSR before withdrawal
    uint256 defaultDelay; // how long to wait until switching vaults after detecting default
    // Ratios
    Fix maxTradeSlippage; // max slippage acceptable in a trade
    Fix dustAmount; // value below which we don't bother handling some tokens {UoA}
    Fix backingBuffer; // percentage of the backing to keep as extra
    Fix issuanceRate; // number of RToken to issue per block / (RToken value)
    Fix defaultThreshold; // multiplier beyond which a token is marked as in-default
    Fix stRSRPayRatio; // the fraction of available revenues that stRSR holders get each PayPeriod

    // Sample values
    //
    // rewardStart = timestamp of first weekly handout
    // rewardPeriod = 604800 (1 week)
    // auctionPeriod = 1800 (30 minutes)
    // stRSRPayPeriod = 86400 (1 day)
    // stRSRWithdrawalDelay = 1209600 (2 weeks)
    // defaultDelay = 86400 (24 hours)

    // maxTradeSlippage = 0.01 (1%)
    // dustAmount = 1 (1 USD)
    // auctionClearingTolerance = 0.1 (10%)
    // backingBuffer = 0.0001 (0.01% extra collateral)
    // issuanceRate = 0.00025 (0.025% per block, or ~0.1% per minute)
    // defaultThreshold = 0.05 (5% deviation, either above or below)
    // stRSRPayRatio = 0.022840031565754093 (half-life of 30 days)
}

// TODO: Put all these contract addresses into their own substructure

struct ConstructorArgs {
    Config config;
    RevenueShare dist;
    IFurnace furnace;
    IMarket market;
    IERC20Metadata rsr;
    IStRSR stRSR;
    IRToken rToken;
    IRTokenIssuer rTokenIssuer;
    IRewardClaimer rewardClaimer;
    IAuctioneer auctioneer;
    IBasketHandler basketHandler;
    IAssetRegistry assetRegistry;
    IRevenueDistributor revenueDistributor;
    ISettings settings;
    IClaimAdapter[] claimAdapters;
    IAsset[] assets;
}

interface IMixin {
    event Initialized();

    function init(ConstructorArgs calldata args) external;
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
interface IMain is IPausable, IMixin {
    event RTokenIssuerSet(IRTokenIssuer indexed oldVal, IRTokenIssuer indexed newVal);

    function rTokenIssuer() external view returns (IRTokenIssuer);

    function setRTokenIssuer(IRTokenIssuer val) external;

    event RewardClaimerSet(IRewardClaimer indexed oldVal, IRewardClaimer indexed newVal);

    function rewardClaimer() external view returns (IRewardClaimer);

    function setRewardClaimer(IRewardClaimer val) external;

    event AuctioneerSet(IAuctioneer indexed oldVal, IAuctioneer indexed newVal);

    function auctioneer() external view returns (IAuctioneer);

    function setAuctioneer(IAuctioneer val) external;

    event BasketHandlerSet(IBasketHandler indexed oldVal, IBasketHandler indexed newVal);

    function basketHandler() external view returns (IBasketHandler);

    function setBasketHandler(IBasketHandler val) external;

    event AssetRegistrySet(IAssetRegistry indexed oldVal, IAssetRegistry indexed newVal);

    function assetRegistry() external view returns (IAssetRegistry);

    function setAssetRegistry(IAssetRegistry val) external;

    event RevenueDistributorSet(
        IRevenueDistributor indexed oldVal,
        IRevenueDistributor indexed newVal
    );

    function revenueDistributor() external view returns (IRevenueDistributor);

    function setRevenueDistributor(IRevenueDistributor val) external;

    event SettingsSet(ISettings indexed oldVal, ISettings indexed newVal);

    function settings() external view returns (ISettings);

    function setSettings(ISettings val) external;

    event RevenueFurnaceSet(IFurnace indexed oldVal, IFurnace indexed newVal);

    function revenueFurnace() external view returns (IFurnace);

    function setRevenueFurnace(IFurnace furnace) external;

    event MarketSet(IMarket indexed oldVal, IMarket indexed newVal);

    function market() external view returns (IMarket);

    function setMarket(IMarket market) external;

    event RTokenSet(IRToken indexed oldVal, IRToken indexed newVal);

    function rToken() external view returns (IRToken);

    function setRToken(IRToken rToken) external;

    event RSRSet(IERC20Metadata indexed oldVal, IERC20Metadata indexed newVal);

    function rsr() external view returns (IERC20Metadata);

    function setRSR(IERC20Metadata rsr) external;

    event StRSRSet(IStRSR indexed oldVal, IStRSR indexed newVal);

    function stRSR() external view returns (IStRSR);

    function setStRSR(IStRSR stRSR) external;

    // ---

    function owner() external view returns (address);
}
