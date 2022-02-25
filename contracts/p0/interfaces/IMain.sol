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
import "./IRewardClaimer.sol";
import "./IRToken.sol";
import "./IRTokenIssuer.sol";
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
    IRTokenIssuer rTokenIssuer;
    IRewardClaimer rewardClaimer;
}

enum AuctionStatus {
    NOT_YET_OPEN,
    OPEN,
    DONE
}

struct Auction {
    IERC20Metadata sell;
    IERC20Metadata buy;
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
    event StRSRPayPeriodSet(uint256 indexed oldVal, uint256 indexed newVal);
    event StRSRWithdrawalDelaySet(uint256 indexed oldVal, uint256 indexed newVal);
    event DefaultDelaySet(uint256 indexed oldVal, uint256 indexed newVal);
    event MaxTradeSlippageSet(Fix indexed oldVal, Fix indexed newVal);
    event DustAmountSet(Fix indexed oldVal, Fix indexed newVal);
    event MinRevenueAuctionSizeSet(Fix indexed oldVal, Fix indexed newVal);
    event IssuanceRateSet(Fix indexed oldVal, Fix indexed newVal);
    event DefaultThresholdSet(Fix indexed oldVal, Fix indexed newVal);
    event StRSRPayRatioSet(Fix indexed oldVal, Fix indexed newVal);
    event StRSRSet(IStRSR indexed oldVal, IStRSR indexed newVal);
    event RevenueFurnaceSet(IFurnace indexed oldVal, IFurnace indexed newVal);
    event RTokenSet(IRToken indexed oldVal, IRToken indexed newVal);
    event RSRSet(IERC20Metadata indexed oldVal, IERC20Metadata indexed newVal);
    event MarketSet(IMarket indexed oldVal, IMarket indexed newVal);

    function setRewardStart(uint256 rewardStart) external;

    function setRewardPeriod(uint256 rewardPeriod) external;

    function setAuctionPeriod(uint256 auctionPeriod) external;

    function setStRSRPayPeriod(uint256 stRSRPayPeriod) external;

    function setStRSRWithdrawalDelay(uint256 stRSRWithdrawalDelay) external;

    function setDefaultDelay(uint256 defaultDelay) external;

    function setMaxTradeSlippage(Fix maxTradeSlippage) external;

    function setDustAmount(Fix dustAMount) external;

    function setMinRevenueAuctionSize(Fix backingBuffer) external;

    function setIssuanceRate(Fix issuanceRate) external;

    function setDefaultThreshold(Fix defaultThreshold) external;

    function setStRSRPayRatio(Fix stRSRPayRatio) external;

    function setStRSR(IStRSR stRSR) external;

    function setRevenueFurnace(IFurnace furnace) external;

    function setRToken(IRToken rToken) external;

    function setRSR(IERC20Metadata rsr) external;

    function setMarket(IMarket market) external;

    //

    function rewardStart() external view returns (uint256);

    function rewardPeriod() external view returns (uint256);

    function auctionPeriod() external view returns (uint256);

    function stRSRPayPeriod() external view returns (uint256);

    function stRSRWithdrawalDelay() external view returns (uint256);

    function defaultDelay() external view returns (uint256);

    function maxTradeSlippage() external view returns (Fix);

    function dustAmount() external view returns (Fix);

    function backingBuffer() external view returns (Fix);

    function issuanceRate() external view returns (Fix);

    function defaultThreshold() external view returns (Fix);

    function stRSRPayRatio() external view returns (Fix);

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
    /// @param erc20 The ERC20 contract for the asset
    /// @param asset The asset contract added to the registry
    event AssetRegistered(IERC20Metadata indexed erc20, IAsset indexed asset);

    /// Emitted when an asset is removed from the registry
    /// @param erc20 The ERC20 contract for the asset
    /// @param asset The asset contract removed from the registry
    event AssetUnregistered(IERC20Metadata indexed erc20, IAsset indexed asset);

    function toAsset(IERC20Metadata erc20) external view returns (IAsset);

    function toColl(IERC20Metadata erc20) external view returns (ICollateral);

    function isRegistered(IERC20Metadata erc20) external view returns (bool);

    function registeredERC20s() external view returns (IERC20Metadata[] memory);
}

interface IBasketHandler {
    /// Emitted when the prime basket is set
    /// @param erc20s The collateral tokens for the prime basket
    /// @param targetAmts {target/BU} A list of quantities of target unit per basket unit
    event PrimeBasketSet(IERC20Metadata[] erc20s, Fix[] targetAmts);

    /// Emitted when the reference basket is set
    /// @param erc20s The list of collateral tokens in the reference basket
    /// @param refAmts {ref/BU} The reference amounts of the basket collateral tokens
    event BasketSet(IERC20Metadata[] erc20s, Fix[] refAmts);

    /// Emitted when a backup config is set for a target unit
    /// @param targetName The name of the target unit as a bytes32
    /// @param max The max number to use from `erc20s`
    /// @param erc20s The set of backup collateral tokens
    event BackupConfigSet(bytes32 indexed targetName, uint256 indexed max, IERC20Metadata[] erc20s);

    /// Set the prime basket
    /// @param erc20s The collateral tokens for the new prime basket
    /// @param targetAmts The target amounts (in) {target/BU} for the new prime basket
    function setPrimeBasket(IERC20Metadata[] memory erc20s, Fix[] memory targetAmts) external;

    /// Set the backup configuration for a given target
    /// @param targetName The name of the target as a bytes32
    /// @param max The maximum number of collateral tokens to use from this target
    /// @param erc20s A list of ordered backup collateral tokens
    function setBackupConfig(
        bytes32 targetName,
        uint256 max,
        IERC20Metadata[] calldata erc20s
    ) external;

    function forceCollateralUpdates() external;

    function ensureValidBasket() external;

    function switchBasket() external returns (bool);

    function fullyCapitalized() external view returns (bool);

    function worstCollateralStatus() external view returns (CollateralStatus status);

    function basketQuote(Fix amount, RoundingApproach rounding)
        external
        view
        returns (IERC20Metadata[] memory erc20s, uint256[] memory quantities);

    function basketsHeldBy(address account) external view returns (Fix baskets);

    function basketPrice() external view returns (Fix price);

    function basketNonce() external view returns (uint256);
}

interface IAuctioneer is ITraderEvents {
    function manageFunds() external;
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
    IAuctioneer
{
    event RTokenIssuerSet(IRTokenIssuer indexed oldVal, IRTokenIssuer indexed newVal);

    function rTokenIssuer() external view returns (IRTokenIssuer);

    event RewardClaimerSet(IRewardClaimer indexed oldVal, IRewardClaimer indexed newVal);

    function rewardClaimer() external view returns (IRewardClaimer);

    function owner() external view returns (address);
}
