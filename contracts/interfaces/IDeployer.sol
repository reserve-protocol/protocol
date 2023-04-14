// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "../libraries/Throttle.sol";
import "./IAsset.sol";
import "./IDistributor.sol";
import "./IGnosis.sol";
import "./IMain.sol";
import "./IRToken.sol";
import "./IStRSR.sol";
import "./ITrade.sol";
import "./IVersioned.sol";

/**
 * @title DeploymentParams
 * @notice The set of protocol params needed to configure a new system deployment.
 * meaning that after deployment there is freedom to allow parametrizations to deviate.
 */
struct DeploymentParams {
    // === Revenue sharing ===
    RevenueShare dist; // revenue sharing splits between RToken and RSR
    //
    // === Trade sizing ===
    uint192 minTradeVolume; // {UoA}
    uint192 rTokenMaxTradeVolume; // {UoA}
    //
    // === Freezing ===
    uint48 shortFreeze; // {s} how long an initial freeze lasts
    uint48 longFreeze; // {s} how long each freeze extension lasts
    //
    // === Rewards (Furnace + StRSR) ===
    uint192 rewardRatio; // the fraction of available revenues that are paid out each 12s period
    //
    // === StRSR ===
    uint48 unstakingDelay; // {s} the "thawing time" of staked RSR before withdrawal
    //
    // === BasketHandler ===
    uint48 warmupPeriod; // {s} how long to wait until issuance/trading after regaining SOUND
    //
    // === BackingManager ===
    uint48 tradingDelay; // {s} how long to wait until starting auctions after switching basket
    uint48 auctionLength; // {s} the length of an auction
    uint48 tradeCooldown; // {s} min seconds between end of a trade and start of a new one
    uint192 swapPricepoint; // {1} the percentile price to use inside a swap; 50% for even prices
    uint192 backingBuffer; // {1} how much extra backing collateral to keep
    uint192 maxTradeSlippage; // {1} max slippage acceptable in an auction
    //
    // === RToken Supply Throttles ===
    ThrottleLib.Params issuanceThrottle; // see ThrottleLib
    ThrottleLib.Params redemptionThrottle;
}

/**
 * @title Implementations
 * @notice The set of implementation contracts to be used for proxies in the Deployer
 */
struct Implementations {
    IMain main;
    Components components;
    ITrade trade;
}

/**
 * @title IDeployer
 * @notice Factory contract for an RToken system instance
 */
interface IDeployer is IVersioned {
    /// Emitted when a new RToken and accompanying system is deployed
    /// @param main The address of `Main`
    /// @param rToken The address of the RToken ERC20
    /// @param stRSR The address of the StRSR ERC20 staking pool/token
    /// @param owner The owner of the newly deployed system
    /// @param version The semantic versioning version string (see: https://semver.org)
    event RTokenCreated(
        IMain indexed main,
        IRToken indexed rToken,
        IStRSR stRSR,
        address indexed owner,
        string version
    );

    //

    /// Deploys an instance of the entire system
    /// @param name The name of the RToken to deploy
    /// @param symbol The symbol of the RToken to deploy
    /// @param mandate An IPFS link or direct string; describes what the RToken _should be_
    /// @param owner The address that should own the entire system, hopefully a governance contract
    /// @param params Deployment params
    /// @return The address of the newly deployed Main instance.
    function deploy(
        string calldata name,
        string calldata symbol,
        string calldata mandate,
        address owner,
        DeploymentParams calldata params
    ) external returns (address);
}

interface TestIDeployer is IDeployer {
    /// A top-level ENS domain that should always point to the latest Deployer instance
    // solhint-disable-next-line func-name-mixedcase
    function ENS() external view returns (string memory);

    function rsr() external view returns (IERC20Metadata);

    function gnosis() external view returns (IGnosis);

    function rsrAsset() external view returns (IAsset);
}
