// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/p0/libraries/Oracle.sol";
import "./IAsset.sol";
import "./IAssetManager.sol";
import "./IDefaultMonitor.sol";
import "./IFurnace.sol";
import "./IRToken.sol";
import "./IStRSR.sol";
import "./IVault.sol";

/// Tracks data for an issuance
/// @param vault The vault the issuance is against
/// @param amount {qTok} The quantity of RToken the issuance is for
/// @param amtBUs {qBU} The number of BUs that corresponded to `amount` at time of issuance
/// @param deposits {qTok} The collateral token quantities that were used to pay for the issuance
/// @param issuer The account issuing RToken
/// @param blockAvailableAt {blockNumber} The block number at which the issuance can complete
/// @param processed false when the issuance is still vesting
struct SlowIssuance {
    IVault vault;
    uint256 amount; // {qTok}
    uint256 amtBUs; // {qBU}
    uint256[] deposits; // {qTok}, same index as vault basket assets
    address issuer;
    uint256 blockAvailableAt; // {blockNumber}
    bool processed;
}

/// The 3 canonical states of the system
enum Mood {
    CALM, // 100% capitalized + no auctions
    DOUBT, // in this state for 24h before default, no auctions or unstaking
    TRADING // auctions in progress, no unstaking
}

/// Configuration of the system
struct Config {
    // Time (seconds)
    uint256 rewardStart; // the timestamp of the very first weekly reward handout
    uint256 rewardPeriod; // the duration of time between reward events
    uint256 auctionPeriod; // the length of an auction
    uint256 stRSRWithdrawalDelay; // the "thawing time" of staked RSR before withdrawal
    uint256 defaultDelay; // how long to wait until switching vaults after detecting default
    // Ratios
    Fix maxTradeSlippage; // the maximum amount of slippage in percentage terms we will accept in a trade
    Fix maxAuctionSize; // the max size of an auction, as a fraction of RToken supply
    Fix minRecapitalizationAuctionSize; // the min size of a recapitalization auction, as a fraction of RToken supply
    Fix minRevenueAuctionSize; // the min size of a revenue auction (RToken/COMP/AAVE), as a fraction of RToken supply
    Fix migrationChunk; // how much backing to migrate at a time, as a fraction of RToken supply
    Fix issuanceRate; // the number of RToken to issue per block, as a fraction of RToken supply
    Fix defaultThreshold; // the percent deviation required before a token is marked as in-default
    Fix f; // The Revenue Factor: the fraction of revenue that goes to stakers
    // TODO: Revenue Distribution Map

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
    // f = 0.6 (60% to stakers)
}

/// Base template for cooperative mixin functions
interface IMixin {
    function poke() external;
}

contract Mixin is IMixin {
    function poke() external virtual override {}
}

interface IPausable {
    function pause() external;

    function unpause() external;

    function paused() external returns (bool);

    function pauser() external view returns (address);

    function setPauser(address pauser_) external;
}

interface IMoody {
    /// Emitted when there is a change in system state.
    event MoodChanged(Mood indexed oldState, Mood indexed newState);

    function mood() external returns (Mood);
}

interface IAssetRegistry {
    function approveCollateral(ICollateral collateral) external;

    function unapproveCollateral(ICollateral collateral) external;
}

// TODO: no f
interface ISettingsHandler {
    // function setRewardStart(uint256 rewardStart) external;

    // function setRewardPeriod(uint256 rewardPeriod) external;

    // function setAuctionPeriod(uint256 auctionPeriod) external;

    // function setStRSRWithdrawalDelay(uint256 stRSRWithdrawalDelay) external;

    // function setDefaultDelay(uint256 defaultDelay) external;

    // function setMaxTradeSlippage(Fix maxTradeSlippage) external;

    // function setMaxAuctionSize(Fix maxTradeSlippage) external;

    // function setMinRecapitalizationAuctionSize(Fix minRecapitalizationAuctionSize) external;

    // function setMinRevenueSize(Fix minRevenueAuctionSize) external;

    // function setMigrationChunk(Fix migrationChunk) external;

    // function setIssuanceRate(Fix issuanceRate) external;

    // function setDefaultThreshold(Fix defaultThreshold) external;

    function setOracle(Oracle.Info memory oracle) external;

    function setStRSR(IStRSR stRSR) external;

    function setFurnace(IFurnace furnace) external;

    function setMonitor(IDefaultMonitor monitor) external;

    function setRTokenAsset(IAsset rTokenAsset) external;

    function setRSRAsset(IAsset rsrAsset) external;

    function setCompAsset(IAsset compAsset) external;

    function setAaveAsset(IAsset aaveAsset) external;

    // TODO: Delete

    function config() external view returns (Config memory);

    /// @return The RToken deployment
    function rToken() external view returns (IRToken);

    /// @return The RSR deployment
    function rsr() external view returns (IERC20);

    function furnace() external view returns (IFurnace);

    function stRSR() external view returns (IStRSR);

    function defaultThreshold() external view returns (Fix);

    function stRSRWithdrawalDelay() external view returns (uint256);

    function setConfig(Config memory config_) external;

    function consultOracle(Oracle.Source source, address token) external view returns (Fix);
}

interface IVaultHandler {
    function switchVault(IVault vault) external;

    function toBUs(uint256 amount) external view returns (uint256);

    function fromBUs(uint256 amtBUs) external view returns (uint256);

    function vault() external view returns (IVault);

    function fullyCapitalized() external view returns (bool);
    // function setF(Fix newF) external;
}

interface IDefaultHandler is IMixin {
    function noticeDefault() external;
}

interface IAuctioneer is IMixin {
    /// Emitted when an auction is started
    /// @param auctionId The index of the AssetManager.auctions array
    /// @param sell The token to sell
    /// @param buy The token to buy
    /// @param sellAmount {qSellTok} The quantity of the selling token
    /// @param minBuyAmount {qBuyTok} The minimum quantity of the buying token to accept
    /// @param fate The fate of the soon-to-be-purchased tokens
    /// @dev Must be kept in sync with its duplicate in `IAssetManager.sol`
    event AuctionStarted(
        uint256 indexed auctionId,
        address indexed sell,
        address indexed buy,
        uint256 sellAmount, // {qSellTok}
        uint256 minBuyAmount, // {qBuyTok}
        Fate fate
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
        uint256 buyAmount,
        Fate fate
    );

    /// Emitted when the current vault is changed
    /// @param oldVault The address of the old vault
    /// @param newVault The address of the new vault
    event NewVaultSet(address indexed oldVault, address indexed newVault);
}

interface IRevenueHandler is IMixin {
    function nextRewards() external view returns (uint256);
}

interface IRTokenIssuer is IMixin {
    /// Emitted when issuance is started, at the point collateral is taken in
    /// @param issuanceId The index off the issuance, a globally unique identifier
    /// @param issuer The account performing the issuance
    /// @param amount The quantity of RToken being issued
    event IssuanceStarted(
        uint256 indexed issuanceId,
        address indexed issuer,
        uint256 indexed amount,
        uint256 blockAvailableAt
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
}

/**
 * @title IMain
 * @notice The central coordinator for the entire system, as well as the external interface.
 * @dev The p0-specific IMain
 */
interface IMain is
    IMixin,
    IPausable,
    IMoody,
    IAssetRegistry,
    ISettingsHandler,
    IVaultHandler,
    IDefaultHandler,
    IAuctioneer,
    IRevenueHandler,
    IRTokenIssuer
{

}
