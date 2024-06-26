// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "./IAsset.sol";
import "./IComponent.sol";
import "./IGnosis.sol";
import "./ITrade.sol";

enum TradeKind {
    DUTCH_AUCTION,
    BATCH_AUCTION
}

/// Cache of all prices for a pair to prevent re-lookup
struct TradePrices {
    uint192 sellLow; // {UoA/sellTok} can be 0
    uint192 sellHigh; // {UoA/sellTok} should not be 0
    uint192 buyLow; // {UoA/buyTok} should not be 0
    uint192 buyHigh; // {UoA/buyTok} should not be 0 or FIX_MAX
}

/// The data format that describes a request for trade with the Broker
struct TradeRequest {
    IAsset sell;
    IAsset buy;
    uint256 sellAmount; // {qSellTok}
    uint256 minBuyAmount; // {qBuyTok}
}

/**
 * @title IBroker
 * @notice The Broker deploys oneshot Trade contracts for Traders and monitors
 *   the continued proper functioning of trading platforms.
 */
interface IBroker is IComponent {
    event GnosisSet(IGnosis oldVal, IGnosis newVal);
    event BatchTradeImplementationSet(ITrade oldVal, ITrade newVal);
    event DutchTradeImplementationSet(ITrade oldVal, ITrade newVal);
    event BatchAuctionLengthSet(uint48 oldVal, uint48 newVal);
    event DutchAuctionLengthSet(uint48 oldVal, uint48 newVal);
    event BatchTradeDisabledSet(bool prevVal, bool newVal);
    event DutchTradeDisabledSet(IERC20Metadata indexed erc20, bool prevVal, bool newVal);

    // Initialization
    function init(
        IMain main_,
        IGnosis gnosis_,
        ITrade batchTradeImplemention_,
        uint48 batchAuctionLength_,
        ITrade dutchTradeImplemention_,
        uint48 dutchAuctionLength_
    ) external;

    /// Request a trade from the broker
    /// @dev Requires setting an allowance in advance
    /// @custom:interaction
    function openTrade(
        TradeKind kind,
        TradeRequest memory req,
        TradePrices memory prices
    ) external returns (ITrade);

    /// Only callable by one of the trading contracts the broker deploys
    function reportViolation() external;

    function batchTradeDisabled() external view returns (bool);

    function dutchTradeDisabled(IERC20Metadata erc20) external view returns (bool);
}

interface IExtendedBroker is IBroker {
    function setBatchTradeImplementation(ITrade newTradeImplementation) external;

    function setDutchTradeImplementation(ITrade newTradeImplementation) external;
}

interface TestIBroker is IBroker {
    function gnosis() external view returns (IGnosis);

    function batchTradeImplementation() external view returns (ITrade);

    function dutchTradeImplementation() external view returns (ITrade);

    function batchAuctionLength() external view returns (uint48);

    function dutchAuctionLength() external view returns (uint48);

    function setGnosis(IGnosis newGnosis) external;

    function setBatchTradeImplementation(ITrade newTradeImplementation) external;

    function setBatchAuctionLength(uint48 newAuctionLength) external;

    function setDutchTradeImplementation(ITrade newTradeImplementation) external;

    function setDutchAuctionLength(uint48 newAuctionLength) external;

    function enableBatchTrade() external;

    function enableDutchTrade(IERC20Metadata erc20) external;

    // only present on pre-3.0.0 Brokers; used by EasyAuction regression test
    function disabled() external view returns (bool);
}
