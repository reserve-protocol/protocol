// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../plugins/trading/DutchTrade.sol";
import "../plugins/trading/GnosisTrade.sol";
import "../interfaces/IBroker.sol";
import "../interfaces/IMain.sol";
import "../interfaces/ITrade.sol";
import "../libraries/Fixed.sol";
import "../libraries/NetworkConfigLib.sol";
import "./mixins/Component.sol";

// Gnosis: uint96 ~= 7e28
uint256 constant GNOSIS_MAX_TOKENS = 7e28;

/// A simple core contract that deploys disposable trading contracts for Traders
contract BrokerP0 is ComponentP0, IBroker {
    using FixLib for uint192;
    using EnumerableSet for EnumerableSet.AddressSet;
    using SafeERC20 for IERC20Metadata;

    uint48 public constant MAX_AUCTION_LENGTH = 604800; // {s} max valid duration -1 week
    // solhint-disable-next-line var-name-mixedcase
    uint48 public immutable MIN_AUCTION_LENGTH; // {s} 2 blocks based on network

    // Added for interface compatibility with P1
    ITrade public batchTradeImplementation;
    ITrade public dutchTradeImplementation;

    IGnosis public gnosis;

    mapping(address => bool) private trades;

    uint48 public batchAuctionLength; // {s} the length of a Gnosis EasyAuction
    uint48 public dutchAuctionLength; // {s} the length of a Dutch Auction

    bool public disabled;

    // 3.0.0
    mapping(TradeKind kind => bool isDisabled) public tradeKindDisabled;

    constructor() {
        MIN_AUCTION_LENGTH = NetworkConfigLib.blocktime() * 2;
    }

    function init(
        IMain main_,
        IGnosis gnosis_,
        ITrade batchTradeImplementation_, // Added for Interface compatibility with P1
        uint48 batchAuctionLength_,
        ITrade dutchTradeImplementation_, // Added for Interface compatibility with P1
        uint48 dutchAuctionLength_
    ) public initializer {
        __Component_init(main_);
        setGnosis(gnosis_);
        setBatchTradeImplementation(batchTradeImplementation_);
        setBatchAuctionLength(batchAuctionLength_);
        setDutchTradeImplementation(dutchTradeImplementation_);
        setDutchAuctionLength(dutchAuctionLength_);
    }

    /// Handle a trade request by deploying a customized disposable trading contract
    /// @param kind TradeKind.DUTCH_AUCTION or TradeKind.BATCH_AUCTION
    /// @dev Requires setting an allowance in advance
    /// @custom:protected
    function openTrade(
        TradeKind kind,
        TradeRequest memory req,
        TradePrices memory prices
    ) external returns (ITrade) {
        require(!tradeKindDisabled[kind], "broker disabled");
        assert(req.sellAmount > 0);

        address caller = _msgSender();
        require(
            caller == address(main.backingManager()) ||
                caller == address(main.rsrTrader()) ||
                caller == address(main.rTokenTrader()),
            "only traders"
        );

        // Must be updated when new TradeKinds are created
        if (kind == TradeKind.BATCH_AUCTION) {
            return newBatchAuction(req, caller);
        } else {
            // kind == TradeKind.DUTCH_AUCTION
            return newDutchAuction(req, prices, ITrading(caller));
        }
    }

    /// Disable the broker until re-enabled by governance
    /// @custom:protected
    function reportViolation() external notTradingPausedOrFrozen {
        require(trades[_msgSender()], "unrecognized trade contract");

        TradeKind kind = ITrade(_msgSender()).KIND();

        emit DisabledSet(kind, tradeKindDisabled[kind], true);
        tradeKindDisabled[kind] = true;
    }

    /// @param maxTokensAllowed {qTok} The max number of sell tokens allowed by the trading platform
    function resizeTrade(
        TradeRequest memory req,
        uint256 maxTokensAllowed
    ) private pure returns (TradeRequest memory) {
        // {qTok}
        uint256 maxQuantity = (req.minBuyAmount > req.sellAmount)
            ? req.minBuyAmount
            : req.sellAmount;

        // Set both sellAmount and minBuyAmount <= maxTokensAllowed
        if (maxQuantity > maxTokensAllowed) {
            req.sellAmount = mulDiv256(req.sellAmount, maxTokensAllowed, maxQuantity, CEIL);
            req.minBuyAmount = mulDiv256(req.minBuyAmount, maxTokensAllowed, maxQuantity, FLOOR);
        }

        return req;
    }

    // === Setters ===

    /// @custom:governance
    function setGnosis(IGnosis newGnosis) public governance {
        require(address(newGnosis) != address(0), "invalid Gnosis address");

        emit GnosisSet(gnosis, newGnosis);
        gnosis = newGnosis;
    }

    /// @custom:governance
    function setBatchTradeImplementation(ITrade newTradeImplementation) public governance {
        require(
            address(newTradeImplementation) != address(0),
            "invalid batchTradeImplementation address"
        );

        emit BatchTradeImplementationSet(batchTradeImplementation, newTradeImplementation);
        batchTradeImplementation = newTradeImplementation;
    }

    /// @custom:governance
    function setBatchAuctionLength(uint48 newAuctionLength) public governance {
        require(
            newAuctionLength == 0 ||
                (newAuctionLength >= MIN_AUCTION_LENGTH && newAuctionLength <= MAX_AUCTION_LENGTH),
            "invalid batchAuctionLength"
        );
        emit BatchAuctionLengthSet(batchAuctionLength, newAuctionLength);
        batchAuctionLength = newAuctionLength;
    }

    /// @custom:governance
    function setDutchTradeImplementation(ITrade newTradeImplementation) public governance {
        require(
            address(newTradeImplementation) != address(0),
            "invalid dutchTradeImplementation address"
        );

        emit DutchTradeImplementationSet(dutchTradeImplementation, newTradeImplementation);
        dutchTradeImplementation = newTradeImplementation;
    }

    /// @custom:governance
    function setDutchAuctionLength(uint48 newAuctionLength) public governance {
        require(
            newAuctionLength == 0 ||
                (newAuctionLength >= MIN_AUCTION_LENGTH && newAuctionLength <= MAX_AUCTION_LENGTH),
            "invalid dutchAuctionLength"
        );
        emit DutchAuctionLengthSet(dutchAuctionLength, newAuctionLength);
        dutchAuctionLength = newAuctionLength;
    }

    // === Private ===

    function newBatchAuction(TradeRequest memory req, address caller) private returns (ITrade) {
        require(batchAuctionLength > 0, "batch auctions not enabled");
        GnosisTrade trade = new GnosisTrade();
        trades[address(trade)] = true;

        // Apply Gnosis EasyAuction-specific resizing of req, if needed: Ensure that
        // max(sellAmount, minBuyAmount) <= maxTokensAllowed, while maintaining their proportion
        uint256 maxQty = (req.minBuyAmount > req.sellAmount) ? req.minBuyAmount : req.sellAmount;

        if (maxQty > GNOSIS_MAX_TOKENS) {
            req.sellAmount = mulDiv256(req.sellAmount, GNOSIS_MAX_TOKENS, maxQty, CEIL);
            req.minBuyAmount = mulDiv256(req.minBuyAmount, GNOSIS_MAX_TOKENS, maxQty, FLOOR);
        }

        IERC20Metadata(address(req.sell.erc20())).safeTransferFrom(
            caller,
            address(trade),
            req.sellAmount
        );

        trade.init(this, caller, gnosis, batchAuctionLength, req);
        return trade;
    }

    function newDutchAuction(
        TradeRequest memory req,
        TradePrices memory prices,
        ITrading caller
    ) private returns (ITrade) {
        require(dutchAuctionLength > 0, "dutch auctions not enabled");
        DutchTrade trade = new DutchTrade();
        trades[address(trade)] = true;

        IERC20Metadata(address(req.sell.erc20())).safeTransferFrom(
            address(caller),
            address(trade),
            req.sellAmount
        );

        trade.init(caller, req.sell, req.buy, req.sellAmount, dutchAuctionLength, prices);
        return trade;
    }

    /// @custom:governance
    function setDisabled(TradeKind kind, bool disabled_) external governance {
        emit DisabledSet(kind, tradeKindDisabled[kind], disabled_);

        tradeKindDisabled[kind] = disabled_;
    }
}
