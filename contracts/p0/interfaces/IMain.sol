// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/p0/libraries/Basket.sol";
import "./IAsset.sol";
import "./IFurnace.sol";
import "./IMarket.sol";
import "./IRToken.sol";
import "./IStRSR.sol";
import "./IOracle.sol";

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
    Fix maxAuctionSize; // max size of an auction / (RToken supply)
    Fix minRecapitalizationAuctionSize; // min size of a recapitalization auction / (RToken supply)
    Fix minRevenueAuctionSize; // min size of a revenue auction / (RToken supply)
    Fix migrationChunk; // how much backing to migrate at a time / (RToken supply)
    Fix issuanceRate; // number of RToken to issue per block / (RToken supply)
    Fix defaultThreshold; // stablecoin deviation beyond which a token is marked as in-default

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
    // minRecapitalizationAuctionSize = 0.001 (0.1%)
    // minRevenueAuctionSize = 0.0001 (0.01%)
    // migrationChunk = 0.2 (20%)
    // issuanceRate = 0.00025 (0.025% per block, or ~0.1% per minute)
    // defaultThreshold = 0.05 (5% deviation)
}

struct RevenueShare {
    Fix rTokenDist;
    Fix rsrDist;
}

struct ConstructorArgs {
    Config config;
    RevenueShare dist;
    IFurnace furnace;
    IMarket market;
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
    function init(ConstructorArgs calldata args) external;

    function poke() external;
}

interface IPausable {
    function pause() external;

    function unpause() external;

    function paused() external returns (bool);

    function pauser() external view returns (address);

    function setPauser(address pauser_) external;
}

interface IAssetRegistry {
    function addAsset(IAsset asset) external;

    function removeAsset(IAsset asset) external;

    function disableCollateral(ICollateral collateral) external;

    function allAssets() external view returns (IAsset[] memory);
}

interface IRevenueDistributor {
    function setDistribution(address dest, RevenueShare memory share) external;

    function distribute(
        IERC20 erc20,
        address from,
        uint256 amount
    ) external;

    function rsrCut() external view returns (Fix);

    function rTokenCut() external view returns (Fix);
}

interface ISettingsHandler {
    function setRewardStart(uint256 rewardStart) external;

    function setRewardPeriod(uint256 rewardPeriod) external;

    function setAuctionPeriod(uint256 auctionPeriod) external;

    function setStRSRWithdrawalDelay(uint256 stRSRWithdrawalDelay) external;

    function setDefaultDelay(uint256 defaultDelay) external;

    function setMaxTradeSlippage(Fix maxTradeSlippage) external;

    function setMaxAuctionSize(Fix maxTradeSlippage) external;

    function setMinRecapitalizationAuctionSize(Fix minRecapitalizationAuctionSize) external;

    function setMinRevenueAuctionSize(Fix minRevenueAuctionSize) external;

    function setMigrationChunk(Fix migrationChunk) external;

    function setIssuanceRate(Fix issuanceRate) external;

    function setDefaultThreshold(Fix defaultThreshold) external;

    function setStRSR(IStRSR stRSR) external;

    function setRevenueFurnace(IFurnace furnace) external;

    function setRTokenAsset(IAsset rTokenAsset) external;

    function setRSRAsset(IAsset rsrAsset) external;

    function setCompAsset(IAsset compAsset) external;

    function setAaveAsset(IAsset aaveAsset) external;

    function setMarket(IMarket market) external;

    //

    function rewardStart() external view returns (uint256);

    function rewardPeriod() external view returns (uint256);

    function auctionPeriod() external view returns (uint256);

    function stRSRWithdrawalDelay() external view returns (uint256);

    function defaultDelay() external view returns (uint256);

    function maxTradeSlippage() external view returns (Fix);

    function maxAuctionSize() external view returns (Fix);

    function minRecapitalizationAuctionSize() external view returns (Fix);

    function minRevenueAuctionSize() external view returns (Fix);

    function migrationChunk() external view returns (Fix);

    function issuanceRate() external view returns (Fix);

    function defaultThreshold() external view returns (Fix);

    function stRSR() external view returns (IStRSR);

    function revenueFurnace() external view returns (IFurnace);

    function rTokenAsset() external view returns (IAsset);

    function rsrAsset() external view returns (IAsset);

    function compAsset() external view returns (IAsset);

    function aaveAsset() external view returns (IAsset);

    function market() external view returns (IMarket);

    /// @return The RToken deployment
    function rToken() external view returns (IRToken);

    /// @return The RSR deployment
    function rsr() external view returns (IERC20);
}

interface IBasketHandler {
    // // TODO figure out what this event turns into
    // /// Emitted when the current vault is changed
    // /// @param oldBasket The address of the old vault
    // /// @param newBasket The address of the new vault
    // // event NewBasketSet(address indexed oldBasket, address indexed newBasket);

    function setBasket(ICollateral[] calldata collateral, Fix[] calldata amounts) external;

    function donateBUs(Fix amtBUs) external;

    function toBUs(uint256 amount) external view returns (Fix);

    function fromBUs(Fix amtBUs) external view returns (uint256);

    function baseFactor() external view returns (Fix);

    function basketPrice() external view returns (Fix);

    function fullyCapitalized() external view returns (bool);

    // This is only here for the Adapter (generic tests)
    function basketReferenceAmounts() external view returns (Fix[] memory);

    // These are only here for the BackingTrader
    function basketCollateralQuantities(Fix amtBUs) external view returns (uint256[] memory);

    function maxIssuableBUs(address account) external view returns (Fix);
}

interface IAuctioneerEvents {
    /// Emitted when an auction is started
    /// @param auctionId The index of the AssetManager.auctions array
    /// @param sell The token to sell
    /// @param buy The token to buy
    /// @param sellAmount {qSellTok} The quantity of the selling token
    /// @param minBuyAmount {qBuyTok} The minimum quantity of the buying token to accept
    event AuctionStarted(
        uint256 indexed auctionId,
        address indexed sell,
        address indexed buy,
        uint256 sellAmount,
        uint256 minBuyAmount
    );

    /// Emitted after an auction ends
    /// @param auctionId The index of the AssetManager.auctions array
    /// @param sellAmount {qSellTok} The quantity of the token sold
    /// @param buyAmount {qBuyTok} The quantity of the token bought
    event AuctionEnded(
        uint256 indexed auctionId,
        address indexed sell,
        address indexed buy,
        uint256 sellAmount,
        uint256 buyAmount
    );
}

interface IAuctioneer {
    function rsrTraderAddr() external view returns (address);

    function rTokenTraderAddr() external view returns (address);

    function backingTraderAddr() external view returns (address);
}

interface IRewardHandler {
    /// Emitted whenever rewards are claimed
    /// @param compAmount {qCOMP} The amount of COMP claimed
    /// @param aaveAmount {qAAVE} The amount of COMP claimed
    event RewardsClaimed(uint256 indexed compAmount, uint256 indexed aaveAmount);

    function nextRewards() external view returns (uint256);
}

interface IRTokenIssuer {
    /// Emitted when issuance is started, at the point collateral is taken in
    /// @param issuanceId The index off the issuance, a globally unique identifier
    /// @param issuer The account performing the issuance
    /// @param amount The quantity of RToken being issued
    /// @param blockAvailableAt The (continuous) block at which the issuance vests
    event IssuanceStarted(
        uint256 indexed issuanceId,
        address indexed issuer,
        uint256 indexed amount,
        Fix blockAvailableAt
    );

    /// Emitted when an RToken issuance is canceled, such as during a default
    /// @param issuanceId The index of the issuance, a globally unique identifier
    event IssuanceCanceled(uint256 indexed issuanceId);

    /// Emitted when an RToken issuance is completed successfully
    /// @param issuanceId The index of the issuance, a globally unique identifier
    event IssuanceCompleted(uint256 indexed issuanceId);

    /// Emitted when a redemption of RToken occurs
    /// @param redeemer The address of the account redeeeming RTokens
    /// @param amount The quantity of RToken being redeemed
    event Redemption(address indexed redeemer, uint256 indexed amount);

    function issue(uint256 amount) external;

    function redeem(uint256 amount) external;

    function backingTokens() external view returns (address[] memory);

    function quote(uint256 amount) external view returns (uint256[] memory);

    function maxIssuable(address account) external view returns (uint256);
}

/**
 * @title IMain
 * @notice The central coordinator for the entire system, as well as the external interface.
 * @dev The p0-specific IMain
 */
// solhint-disable-next-line no-empty-blocks
interface IMain is
    IPausable,
    IMixin,
    IAssetRegistry,
    ISettingsHandler,
    IRevenueDistributor,
    IBasketHandler,
    IAuctioneer,
    IRewardHandler,
    IRTokenIssuer
{
    function owner() external view returns (address);
}
