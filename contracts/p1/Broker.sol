// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";
import "../interfaces/IBroker.sol";
import "../interfaces/IMain.sol";
import "../interfaces/ITrade.sol";
import "../libraries/Fixed.sol";
import "../libraries/NetworkConfigLib.sol";
import "./mixins/Component.sol";
import "../plugins/trading/DutchTrade.sol";
import "../plugins/trading/GnosisTrade.sol";

// Gnosis: uint96 ~= 7e28
uint256 constant GNOSIS_MAX_TOKENS = 7e28;

/// A simple core contract that deploys disposable trading contracts for Traders
contract BrokerP1 is ComponentP1, IBroker {
    using EnumerableSet for EnumerableSet.AddressSet;
    using FixLib for uint192;
    using SafeERC20Upgradeable for IERC20Upgradeable;
    using Clones for address;

    uint48 public constant MAX_AUCTION_LENGTH = 604800; // {s} max valid duration - 1 week
    /// @custom:oz-upgrades-unsafe-allow state-variable-immutable
    // solhint-disable-next-line var-name-mixedcase
    uint48 public immutable MIN_AUCTION_LENGTH; // {s} 2 blocks based on network

    IBackingManager private backingManager;
    IRevenueTrader private rsrTrader;
    IRevenueTrader private rTokenTrader;

    /// @custom:oz-renamed-from tradeImplementation
    // The Batch Auction Trade contract to clone on openTrade(). Governance parameter.
    ITrade public batchTradeImplementation;

    // The Gnosis contract to init batch auction trades with. Governance parameter.
    IGnosis public gnosis;

    /// @custom:oz-renamed-from auctionLength
    // {s} the length of a Gnosis EasyAuction. Governance parameter.
    uint48 public batchAuctionLength;

    // Whether trading is disabled.
    // Initially false. Settable by OWNER. A trade clone can set it to true via reportViolation()
    // @deprecated in 3.0.0
    bool public disabled;

    // The set of ITrade (clone) addresses this contract has created
    mapping(address => bool) private trades;

    // === 3.0.0 ===

    // The Dutch Auction Trade contract to clone on openTrade(). Governance parameter.
    ITrade public dutchTradeImplementation;

    // {s} the length of a Dutch Auction. Governance parameter.
    uint48 public dutchAuctionLength;

    // ==== Invariant ====
    // (trades[addr] == true) iff this contract has created an ITrade clone at addr

    // === 3.0.0 === Violation by trade kind
    mapping(TradeKind => bool) public tradeKindDisabled;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        MIN_AUCTION_LENGTH = NetworkConfigLib.blocktime() * 2;
    }

    // effects: initial parameters are set
    function init(
        IMain main_,
        IGnosis gnosis_,
        ITrade batchTradeImplementation_,
        uint48 batchAuctionLength_,
        ITrade dutchTradeImplementation_,
        uint48 dutchAuctionLength_
    ) external initializer {
        __Component_init(main_);

        backingManager = main_.backingManager();
        rsrTrader = main_.rsrTrader();
        rTokenTrader = main_.rTokenTrader();

        setGnosis(gnosis_);
        setBatchTradeImplementation(batchTradeImplementation_);
        setBatchAuctionLength(batchAuctionLength_);
        setDutchTradeImplementation(dutchTradeImplementation_);
        setDutchAuctionLength(dutchAuctionLength_);
    }

    /// Handle a trade request by deploying a customized disposable trading contract
    /// @param kind TradeKind.DUTCH_AUCTION or TradeKind.BATCH_AUCTION
    /// @dev Requires setting an allowance in advance
    /// @custom:protected and @custom:interaction CEI
    // checks:
    //   not disabled, paused (trading), or frozen
    //   caller is a system Trader
    // effects:
    //   Deploys a new trade clone, `trade`
    //   trades'[trade] = true
    // actions:
    //   Transfers req.sellAmount of req.sell.erc20 from caller to `trade`
    //   Calls trade.init() with appropriate parameters
    function openTrade(
        TradeKind kind,
        TradeRequest memory req,
        TradePrices memory prices
    ) external returns (ITrade) {
        require(!tradeKindDisabled[kind], "broker disabled");

        address caller = _msgSender();
        require(
            caller == address(backingManager) ||
                caller == address(rsrTrader) ||
                caller == address(rTokenTrader),
            "only traders"
        );

        // Must be updated when new TradeKinds are created
        if (kind == TradeKind.BATCH_AUCTION) {
            return newBatchAuction(req, caller);
        }
        return newDutchAuction(req, prices, ITrading(caller));
    }

    /// Disable the broker until re-enabled by governance
    /// @custom:protected
    // checks: not paused (trading), not frozen, caller is a Trade this contract cloned
    // effects: disabled' = true
    function reportViolation() external notTradingPausedOrFrozen {
        require(trades[_msgSender()], "unrecognized trade contract");

        TradeKind kind = ITrade(_msgSender()).KIND();

        emit DisabledSet(kind, tradeKindDisabled[kind], true);
        tradeKindDisabled[kind] = true;
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

    /// @custom:governance
    function setDisabled(TradeKind kind, bool disabled_) external governance {
        emit DisabledSet(kind, tradeKindDisabled[kind], disabled_);

        tradeKindDisabled[kind] = disabled_;
    }

    // === Private ===

    function newBatchAuction(TradeRequest memory req, address caller) private returns (ITrade) {
        require(batchAuctionLength > 0, "batch auctions not enabled");
        GnosisTrade trade = GnosisTrade(address(batchTradeImplementation).clone());
        trades[address(trade)] = true;

        // Apply Gnosis EasyAuction-specific resizing of req, if needed: Ensure that
        // max(sellAmount, minBuyAmount) <= maxTokensAllowed, while maintaining their proportion
        uint256 maxQty = (req.minBuyAmount > req.sellAmount) ? req.minBuyAmount : req.sellAmount;

        if (maxQty > GNOSIS_MAX_TOKENS) {
            req.sellAmount = mulDiv256(req.sellAmount, GNOSIS_MAX_TOKENS, maxQty, CEIL);
            req.minBuyAmount = mulDiv256(req.minBuyAmount, GNOSIS_MAX_TOKENS, maxQty, FLOOR);
        }

        // == Interactions ==
        IERC20Upgradeable(address(req.sell.erc20())).safeTransferFrom(
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
        DutchTrade trade = DutchTrade(address(dutchTradeImplementation).clone());
        trades[address(trade)] = true;

        // == Interactions ==
        IERC20Upgradeable(address(req.sell.erc20())).safeTransferFrom(
            address(caller),
            address(trade),
            req.sellAmount
        );

        trade.init(caller, req.sell, req.buy, req.sellAmount, dutchAuctionLength, prices);
        return trade;
    }

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[42] private __gap;
}
