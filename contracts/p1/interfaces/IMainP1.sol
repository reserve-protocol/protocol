// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/p1/libraries/OracleP1.sol";
import "./IAssetP1.sol";
import "./IAssetManagerP1.sol";
import "./IDefaultMonitorP1.sol";
import "./IFurnaceP1.sol";
import "./IRTokenP1.sol";
import "./IStRSRP1.sol";
import "./IVaultP1.sol";

/// The 3 canonical states of the system
enum State {
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
    Fix auctionClearingTolerance; // the maximum % difference between auction clearing price and oracle data allowed.
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

/// Tracks data for an issuance
/// @param vault The vault the issuance is against
/// @param amount {qTok} The quantity of RToken the issuance is for
/// @param BUs {qBU} The number of BUs that corresponded to `amount` at time of issuance
/// @param deposits {qTok} The collateral token quantities that were used to pay for the issuance
/// @param issuer The account issuing RToken
/// @param blockAvailableAt {blockNumber} The block number at which the issuance can complete
/// @param processed false when the issuance is still vesting
struct SlowIssuance {
    IVaultP1 vault;
    uint256 amount; // {qTok}
    uint256 BUs; // {qBU}
    uint256[] deposits; // {qTok}, same index as vault basket assets
    address issuer;
    uint256 blockAvailableAt; // {blockNumber}
    bool processed;
}

/**
 * @title IMainP1
 * @notice The central coordinator for the entire system, as well as the external interface.
 * @dev
 */
interface IMainP1 {
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

    /// Emitted when there is a change in system state.
    event StateChanged(State indexed oldState, State indexed newState);

    //

    /// Begin a time-delayed issuance of RToken for basket collateral
    /// @param amount The quantity {qRToken} of RToken to issue
    function issue(uint256 amount) external;

    /// Redeem RToken for basket collateral
    /// @param amount The quantity {qRToken} of RToken to redeem
    function redeem(uint256 amount) external;

    /// Runs the central auction loop
    function poke() external;

    /// Performs the expensive checks for default, such as calculating VWAPs
    function noticeDefault() external;

    /// @return Whether the system is paused
    function paused() external view returns (bool);

    /// @return erc20s The addresses of the ERC20s backing the RToken
    function backingTokens() external view returns (address[] memory);

    /// @return The timestamp of the next rewards event
    function nextRewards() external view returns (uint256);

    // System-internal API

    /// @return The RSR ERC20 deployment on this chain
    function rsr() external view returns (IERC20);

    /// @return The RToken provided by the system
    function rToken() external view returns (IRTokenP1);

    /// @return The RToken Furnace associated with this RToken instance
    function furnace() external view returns (IFurnaceP1);

    /// @return The staked form of RSR for this RToken instance
    function stRSR() external view returns (IStRSRP1);

    /// @return The AssetManager associated with this RToken instance
    function manager() external view returns (IAssetManagerP1);

    /// @return The DefaultMonitor associated with this RToken instance
    function monitor() external view returns (IDefaultMonitorP1);

    /// @return {attoUSD/qTok} The price in attoUSD of `token` on oracle `source`.
    function consultOracle(OracleP1.Source source, address token) external view returns (Fix);

    /// @return The deployment of the comptroller on this chain
    function comptroller() external view returns (IComptroller);

    /// @return The asset for the RToken
    function rTokenAsset() external view returns (IAssetP1);

    /// @return The asset for RSR
    function rsrAsset() external view returns (IAssetP1);

    /// @return The asset for COMP
    function compAsset() external view returns (IAssetP1);

    /// @return The asset for AAVE
    function aaveAsset() external view returns (IAssetP1);

    /// @return The system configuration
    function config() external view returns (Config memory);
}
