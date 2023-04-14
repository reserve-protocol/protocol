// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";
import "../interfaces/IBroker.sol";
import "../interfaces/IMain.sol";
import "../interfaces/ITrade.sol";
import "../libraries/Fixed.sol";
import "./mixins/Component.sol";
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

    IBackingManager private backingManager;
    IRevenueTrader private rsrTrader;
    IRevenueTrader private rTokenTrader;

    // The trade contract to clone on openTrade(). Governance parameter.
    ITrade public tradeImplementation;

    // The Gnosis contract to init each trade with. Governance parameter.
    IGnosis public gnosis;

    // {s} the length of an auction. Governance parameter.
    uint48 public auctionLength;

    // Whether trading is disabled.
    // Initially false. Settable by OWNER. A trade clone can set it to true via reportViolation()
    bool public disabled;

    // The set of ITrade (clone) addresses this contract has created
    mapping(address => bool) private trades;

    // ==== Invariant ====
    // (trades[addr] == true) iff this contract has created an ITrade clone at addr

    // effects: initial parameters are set
    function init(
        IMain main_,
        IGnosis gnosis_,
        ITrade tradeImplementation_,
        uint48 auctionLength_
    ) external initializer {
        __Component_init(main_);

        backingManager = main_.backingManager();
        rsrTrader = main_.rsrTrader();
        rTokenTrader = main_.rTokenTrader();

        setGnosis(gnosis_);
        setTradeImplementation(tradeImplementation_);
        setAuctionLength(auctionLength_);
    }

    /// Handle a trade request by deploying a customized disposable trading contract
    /// @dev Requires setting an allowance in advance
    /// @custom:interaction CEI
    // checks:
    //   not disabled, paused, or frozen
    //   caller is a system Trader
    // effects:
    //   Deploys a new trade clone, `trade`
    //   trades'[trade] = true
    // actions:
    //   Transfers req.sellAmount of req.sell.erc20 from caller to `trade`
    //   Calls trade.init() with appropriate parameters
    function openTrade(TradeRequest memory req) external notPausedOrFrozen returns (ITrade) {
        require(!disabled, "broker disabled");

        address caller = _msgSender();
        require(
            caller == address(backingManager) ||
                caller == address(rsrTrader) ||
                caller == address(rTokenTrader),
            "only traders"
        );

        // In the future we'll have more sophisticated choice logic here, probably by trade size
        GnosisTrade trade = GnosisTrade(address(tradeImplementation).clone());
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

        trade.init(this, caller, gnosis, auctionLength, req);
        return trade;
    }

    /// Disable the broker until re-enabled by governance
    /// @custom:protected
    // checks: not paused, not frozen, caller is a Trade this contract cloned
    // effects: disabled' = true
    function reportViolation() external notPausedOrFrozen {
        require(trades[_msgSender()], "unrecognized trade contract");
        emit DisabledSet(disabled, true);
        disabled = true;
    }

    // === Setters ===

    /// @custom:governance
    function setGnosis(IGnosis newGnosis) public governance {
        require(address(newGnosis) != address(0), "invalid Gnosis address");

        emit GnosisSet(gnosis, newGnosis);
        gnosis = newGnosis;
    }

    /// @custom:governance
    function setTradeImplementation(ITrade newTradeImplementation) public governance {
        require(
            address(newTradeImplementation) != address(0),
            "invalid Trade Implementation address"
        );

        emit TradeImplementationSet(tradeImplementation, newTradeImplementation);
        tradeImplementation = newTradeImplementation;
    }

    /// @custom:governance
    function setAuctionLength(uint48 newAuctionLength) public governance {
        require(
            newAuctionLength > 0 && newAuctionLength <= MAX_AUCTION_LENGTH,
            "invalid auctionLength"
        );
        emit AuctionLengthSet(auctionLength, newAuctionLength);
        auctionLength = newAuctionLength;
    }

    /// @custom:governance
    function setDisabled(bool disabled_) external governance {
        emit DisabledSet(disabled, disabled_);
        disabled = disabled_;
    }

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[44] private __gap;
}
