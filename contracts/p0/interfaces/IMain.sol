// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./IAsset.sol";
import "./IClaimAdapter.sol";
import "./IFurnace.sol";
import "./IMarket.sol";
import "./IRToken.sol";
import "./IStRSR.sol";
import "./ITrader.sol";

/// Configuration of the system
struct Config {
    // Time (seconds)
    uint256 rewardStart; // the timestamp of the very first weekly reward handout
    uint256 rewardPeriod; // the duration of time between reward events
    uint256 auctionPeriod; // the length of an auction
    uint256 stRSRWithdrawalDelay; // the "thawing time" of staked RSR before withdrawal
    uint256 defaultDelay; // how long to wait until switching vaults after detecting default
    // Ratios
    Fix maxTradeSlippage; // max slippage acceptable in a trade
    Fix maxAuctionSize; // max size of an auction / (RToken value)
    Fix minRevenueAuctionSize; // min size of a revenue auction and surplus buffer/(RToken value)
    Fix issuanceRate; // number of RToken to issue per block / (RToken value)
    Fix defaultThreshold; // multiplier beyond which a token is marked as in-default

    // Sample values
    //
    // rewardStart = timestamp of first weekly handout
    // rewardPeriod = 604800 (1 week)
    // auctionPeriod = 1800 (30 minutes)
    // stRSRWithdrawalDelay = 1209600 (2 weeks)
    // defaultDelay = 86400 (24 hours)

    // maxTradeSlippage = 0.01 (1%)
    // auctionClearingTolerance = 0.1 (10%)
    // maxAuctionSize = 0.01 (1%)
    // minRevenueAuctionSize = 0.001 (0.1%)
    // issuanceRate = 0.00025 (0.025% per block, or ~0.1% per minute)
    // defaultThreshold = 0.05 (5% deviation, either above or below)
}

struct RevenueShare {
    uint16 rTokenDist;
    uint16 rsrDist;
}

struct ConstructorArgs {
    Config config;
    RevenueShare dist;
    IFurnace furnace;
    IMarket market;
    IERC20Metadata rsr;
    IStRSR stRSR;
    IRToken rToken;
    IClaimAdapter[] claimAdapters;
    IAsset[] assets;
}

enum AuctionStatus {
    NOT_YET_OPEN,
    OPEN,
    DONE
}

struct Auction {
    IAsset sell;
    IAsset buy;
    uint256 sellAmount; // {qSellTok}
    uint256 minBuyAmount; // {qBuyTok}
    uint256 startTime; // {sec}
    uint256 endTime; // {sec}
    uint256 clearingSellAmount; // only defined if status == DONE
    uint256 clearingBuyAmount; // only defined if status == DONE
    uint256 externalAuctionId; // only defined if status > NOT_YET_OPEN
    AuctionStatus status;
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

interface ISettingsHandler {
    event RewardStartSet(uint256 indexed oldVal, uint256 indexed newVal);
    event RewardPeriodSet(uint256 indexed oldVal, uint256 indexed newVal);
    event AuctionPeriodSet(uint256 indexed oldVal, uint256 indexed newVal);
    event StRSRWithdrawalDelaySet(uint256 indexed oldVal, uint256 indexed newVal);
    event DefaultDelaySet(uint256 indexed oldVal, uint256 indexed newVal);
    event MaxTradeSlippageSet(Fix indexed oldVal, Fix indexed newVal);
    event MaxAuctionSizeSet(Fix indexed oldVal, Fix indexed newVal);
    event MinRevenueAuctionSizeSet(Fix indexed oldVal, Fix indexed newVal);
    event IssuanceRateSet(Fix indexed oldVal, Fix indexed newVal);
    event DefaultThresholdSet(Fix indexed oldVal, Fix indexed newVal);
    event StRSRSet(IStRSR indexed oldVal, IStRSR indexed newVal);
    event RevenueFurnaceSet(IFurnace indexed oldVal, IFurnace indexed newVal);
    event RTokenSet(IRToken indexed oldVal, IRToken indexed newVal);
    event RSRSet(IERC20Metadata indexed oldVal, IERC20Metadata indexed newVal);
    event MarketSet(IMarket indexed oldVal, IMarket indexed newVal);

    function setRewardStart(uint256 rewardStart) external;

    function setRewardPeriod(uint256 rewardPeriod) external;

    function setAuctionPeriod(uint256 auctionPeriod) external;

    function setStRSRWithdrawalDelay(uint256 stRSRWithdrawalDelay) external;

    function setDefaultDelay(uint256 defaultDelay) external;

    function setMaxTradeSlippage(Fix maxTradeSlippage) external;

    function setMaxAuctionSize(Fix maxAuctionSize) external;

    function setMinRevenueAuctionSize(Fix minRevenueAuctionSize) external;

    function setIssuanceRate(Fix issuanceRate) external;

    function setDefaultThreshold(Fix defaultThreshold) external;

    function setStRSR(IStRSR stRSR) external;

    function setRevenueFurnace(IFurnace furnace) external;

    function setRToken(IRToken rToken) external;

    function setRSR(IERC20Metadata rsr) external;

    function setMarket(IMarket market) external;

    //

    function rewardStart() external view returns (uint256);

    function rewardPeriod() external view returns (uint256);

    function auctionPeriod() external view returns (uint256);

    function stRSRWithdrawalDelay() external view returns (uint256);

    function defaultDelay() external view returns (uint256);

    function maxTradeSlippage() external view returns (Fix);

    function maxAuctionSize() external view returns (Fix);

    function minRevenueAuctionSize() external view returns (Fix);

    function issuanceRate() external view returns (Fix);

    function defaultThreshold() external view returns (Fix);

    function stRSR() external view returns (IStRSR);

    function revenueFurnace() external view returns (IFurnace);

    function market() external view returns (IMarket);

    function rToken() external view returns (IRToken);

    function rsr() external view returns (IERC20Metadata);
}

interface IRevenueDistributor {
    /// Emitted when a distribution is set
    /// @param dest The address set to receive the distribution
    /// @param rTokenDist The distribution of RToken that should go to `dest`
    /// @param rsrDist The distribution of RSR that should go to `dest`
    event DistributionSet(address dest, uint16 rTokenDist, uint16 rsrDist);

    function setDistribution(address dest, RevenueShare memory share) external;

    function distribute(
        IERC20 erc20,
        address from,
        uint256 amount
    ) external;

    function rsrCut() external view returns (uint256 rsrShares, uint256 totalShares);

    function rTokenCut() external view returns (uint256 rtokenShares, uint256 totalShares);
}

interface IAssetRegistry {
    /// Emitted when an asset is added to the registry
    /// @param asset The asset contract added to the registry
    event AssetRegistered(IAsset indexed asset);

    /// Emitted when an asset is removed from the registry
    /// @param asset The asset contract removed from the registry
    event AssetUnregistered(IAsset indexed asset);

    function registerAsset(IAsset asset) external returns (bool);

    function swapRegisteredAsset(IAsset asset) external returns (bool swapped);

    function unregisterAsset(IAsset asset) external returns (bool);

    function assetFor(IERC20Metadata erc20) external view returns (IAsset);

    function allAssets() external view returns (IAsset[] memory);
}

interface IBasketHandler {
    /// Emitted when the target basket is set
    /// @param collateral The collateral for the target basket
    /// @param targetAmts {target/BU} A list of quantities of target unit per basket unit
    event TargetBasketSet(ICollateral[] collateral, Fix[] targetAmts);

    /// Emitted when the reference basket is freshly derived from the target basket
    /// @param collateral The list of collateral in the basket
    /// @param refAmts {ref/BU} The reference amounts of the basket
    event ReferenceBasketSet(ICollateral[] collateral, Fix[] refAmts);

    /// Emitted when a backup config is set for a target unit
    /// @param targetName The name of the target unit as a bytes32
    /// @param maxCollateral The max number to use from `collateral`
    /// @param collateral The set of permissible collateral to use
    /// @param maxAmts The max weights for each collateral
    event TargetConfigured(
        bytes32 indexed targetName,
        uint256 indexed maxCollateral,
        ICollateral[] collateral,
        Fix[] maxAmts
    );

    /// Set the basket directly
    /// @param collateral The collateral for the new prime basket
    /// @param targetAmts The target amounts (in) {target/BU} for the new prime basket
    function setTargetBasket(ICollateral[] memory collateral, Fix[] memory targetAmts) external;

    /// Configure the Target given by targetName
    /// @param targetName The name of the target as a bytes32
    /// @param maxCollateral The maximum number of collateral tokens to use from this target
    /// @param collateral A list of ordered backup collateral, not necessarily registered
    /// @param maxAmts The corresponding maximum weights per basket unit, for each collateral
    function configureTarget(
        bytes32 targetName,
        uint256 maxCollateral,
        ICollateral[] calldata collateral,
        Fix[] calldata maxAmts
    ) external;

    function forceCollateralUpdates() external;

    function ensureValidBasket() external;

    function switchBasket() external returns (bool);

    function fullyCapitalized() external view returns (bool);

    function worstCollateralStatus() external view returns (CollateralStatus status);

    function blockBasketLastChanged() external view returns (uint256);

    function totalAssetValue() external view returns (Fix p);
}

interface IAuctioneer is ITraderEvents {
    function manageFunds() external;
}

interface IRewardClaimerEvents {
    /// Emitted whenever rewards are claimed
    event RewardsClaimed(address indexed erc20, uint256 indexed amount);
}

interface IRewardClaimer is IRewardClaimerEvents {
    /// Emitted whenever a claim adapter is added by governance
    event ClaimAdapterAdded(IClaimAdapter indexed adapter);
    /// Emitted whenever a claim adapter is removed by governance
    event ClaimAdapterRemoved(IClaimAdapter indexed adapter);

    function claimRewards() external;

    function addClaimAdapter(IClaimAdapter claimAdapter) external;

    function removeClaimAdapter(IClaimAdapter claimAdapter) external;

    function isTrustedClaimAdapter(IClaimAdapter claimAdapter_) external view returns (bool);

    function claimAdapters() external view returns (IClaimAdapter[] memory adapters);
}

interface IRTokenIssuer {
    /// Emitted when an issuance of RToken begins
    /// @param issuer The address of the account redeeeming RTokens
    /// @param amount The quantity of RToken being issued
    /// @param baskets The corresponding number of baskets
    event IssuanceStarted(address indexed issuer, uint256 indexed amount, Fix indexed baskets);

    /// Emitted when a redemption of RToken occurs
    /// @param redeemer The address of the account redeeeming RTokens
    /// @param amount The quantity of RToken being redeemed
    /// @param baskets The corresponding number of baskets
    event Redemption(address indexed redeemer, uint256 indexed amount, Fix indexed baskets);

    function issue(uint256 amount) external returns (uint256[] memory deposits);

    function redeem(uint256 amount) external returns (uint256[] memory compensation);

    function basketCollateral() external view returns (ICollateral[] memory);

    function maxIssuable(address account) external view returns (uint256);

    // {UoA/rTok}
    function rTokenPrice() external view returns (Fix p);
}

/**
 * @title IMain
 * @notice The central coordinator for the entire system, as well as the external interface.
 * @dev The p0-specific IMain
 */
interface IMain is
    IPausable,
    IMixin,
    ISettingsHandler,
    IRevenueDistributor,
    IAssetRegistry,
    IBasketHandler,
    IAuctioneer,
    IRewardClaimer,
    IRTokenIssuer
{
    function owner() external view returns (address);
}
