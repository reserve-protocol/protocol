// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";
import "../interfaces/IBroker.sol";
import "../interfaces/IMain.sol";
import "../interfaces/ITrade.sol";
import "../libraries/Fixed.sol";
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

    uint48 public constant MAX_AUCTION_LENGTH = 60 * 60 * 24 * 7; // {s} max valid duration, 1 week
    /// @custom:oz-upgrades-unsafe-allow state-variable-immutable
    // solhint-disable-next-line var-name-mixedcase
    uint48 public constant MIN_AUCTION_LENGTH = 60; // {s} 60 seconds auction min duration

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

    // Whether Batch Auctions are disabled.
    // Initially false. Settable by OWNER.
    // A GnosisTrade clone can set it to true via reportViolation()
    /// @custom:oz-renamed-from disabled
    bool public batchTradeDisabled;

    // The set of ITrade (clone) addresses this contract has created
    mapping(address => bool) private trades;

    // === 3.0.0 ===

    // The Dutch Auction Trade contract to clone on openTrade(). Governance parameter.
    ITrade public dutchTradeImplementation;

    // {s} the length of a Dutch Auction. Governance parameter.
    uint48 public dutchAuctionLength;

    // Whether Dutch Auctions are currently disabled, per ERC20
    mapping(IERC20Metadata => bool) public dutchTradeDisabled;

    // === 3.1.0 ===

    IRToken private rToken;

    // ==== Invariant ====
    // (trades[addr] == true) iff this contract has created an ITrade clone at addr

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
        cacheComponents();

        setGnosis(gnosis_);

        require(
            address(batchTradeImplementation_) != address(0),
            "invalid batchTradeImplementation address"
        );
        require(
            address(dutchTradeImplementation_) != address(0),
            "invalid dutchTradeImplementation address"
        );

        batchTradeImplementation = batchTradeImplementation_;
        dutchTradeImplementation = dutchTradeImplementation_;

        emit BatchTradeImplementationSet(ITrade(address(0)), batchTradeImplementation_);
        emit DutchTradeImplementationSet(ITrade(address(0)), dutchTradeImplementation_);

        setBatchAuctionLength(batchAuctionLength_);
        setDutchAuctionLength(dutchAuctionLength_);
    }

    /// Call after upgrade to >= 3.1.0
    function cacheComponents() public {
        backingManager = main.backingManager();
        rsrTrader = main.rsrTrader();
        rTokenTrader = main.rTokenTrader();
        rToken = main.rToken();
    }

    /// Handle a trade request by deploying a customized disposable trading contract
    /// @param kind TradeKind.DUTCH_AUCTION or TradeKind.BATCH_AUCTION
    /// @dev Requires setting an allowance in advance
    /// @custom:protected and @custom:interaction CEI
    // checks:
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
    // checks: caller is a Trade this contract cloned
    // effects: disabled' = true
    function reportViolation() external {
        require(trades[_msgSender()], "unrecognized trade contract");
        ITrade trade = ITrade(_msgSender());
        TradeKind kind = trade.KIND();

        if (kind == TradeKind.BATCH_AUCTION) {
            emit BatchTradeDisabledSet(batchTradeDisabled, true);
            batchTradeDisabled = true;
        } else if (kind == TradeKind.DUTCH_AUCTION) {
            // Only allow BackingManager-started trades to disable Dutch Auctions
            if (DutchTrade(address(trade)).origin() == backingManager) {
                IERC20Metadata sell = trade.sell();
                emit DutchTradeDisabledSet(sell, dutchTradeDisabled[sell], true);
                dutchTradeDisabled[sell] = true;

                IERC20Metadata buy = trade.buy();
                emit DutchTradeDisabledSet(buy, dutchTradeDisabled[buy], true);
                dutchTradeDisabled[buy] = true;
            }
        } else {
            // untestable: trade kind is either BATCH or DUTCH
            revert("unrecognized trade kind");
        }
    }

    // === Setters ===

    /// @custom:governance
    function setGnosis(IGnosis newGnosis) public governance {
        require(address(newGnosis) != address(0), "invalid Gnosis address");

        emit GnosisSet(gnosis, newGnosis);
        gnosis = newGnosis;
    }

    /// @custom:main
    function setBatchTradeImplementation(ITrade newTradeImplementation) public onlyMain {
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

    /// @custom:main
    function setDutchTradeImplementation(ITrade newTradeImplementation) public onlyMain {
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
    function enableBatchTrade() external governance {
        emit BatchTradeDisabledSet(batchTradeDisabled, false);
        batchTradeDisabled = false;
    }

    /// @custom:governance
    function enableDutchTrade(IERC20Metadata erc20) external governance {
        emit DutchTradeDisabledSet(erc20, dutchTradeDisabled[erc20], false);
        dutchTradeDisabled[erc20] = false;
    }

    // === Private ===

    function newBatchAuction(TradeRequest memory req, address caller) private returns (ITrade) {
        require(!batchTradeDisabled, "batch auctions disabled");
        require(batchAuctionLength != 0, "batch auctions not enabled");
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
        require(
            !dutchTradeDisabled[req.sell.erc20()] && !dutchTradeDisabled[req.buy.erc20()],
            "dutch auctions disabled for token pair"
        );
        require(dutchAuctionLength != 0, "dutch auctions not enabled");
        require(
            pricedAtTimestamp(req.sell) && pricedAtTimestamp(req.buy),
            "dutch auctions require live prices"
        );

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

    /// @return true iff the asset has been priced at this timestamp, or it's the RTokenAsset
    function pricedAtTimestamp(IAsset asset) private view returns (bool) {
        return asset.lastSave() == block.timestamp || address(asset.erc20()) == address(rToken);
    }

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[41] private __gap;
}
