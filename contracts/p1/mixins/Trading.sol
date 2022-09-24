// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/Multicall.sol";
import "contracts/interfaces/ITrade.sol";
import "contracts/interfaces/ITrading.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/p1/mixins/Component.sol";
import "contracts/p1/mixins/RewardableLib.sol";

/// Abstract trading mixin for all Traders, to be paired with TradingLib
/// @dev See docs/security for discussion of Multicall safety
abstract contract TradingP1 is Multicall, ComponentP1, ReentrancyGuardUpgradeable, ITrading {
    using FixLib for uint192;
    using SafeERC20Upgradeable for IERC20Upgradeable;

    uint192 public constant MIN_TRADE_VOLUME = 1e29; // {UoA}
    uint192 public constant MAX_TRADE_SLIPPAGE = 1e18; // {%}

    // All open trades
    mapping(IERC20 => ITrade) public trades;
    uint48 public tradesOpen;

    // === Governance param ===
    uint192 public maxTradeSlippage; // {%}

    uint192 public minTradeVolume; // {UoA}

    // ==== Invariants ====
    // tradesOpen = len(values(trades))
    // trades[sell] != 0 iff trade[sell] has been opened and not yet settled

    // solhint-disable-next-line func-name-mixedcase
    function __Trading_init(uint192 maxTradeSlippage_, uint192 minTradeVolume_)
        internal
        onlyInitializing
    {
        setMaxTradeSlippage(maxTradeSlippage_);
        setMinTradeVolume(minTradeVolume_);
    }

    /// Settle a single trade, expected to be used with multicall for efficient mass settlement
    /// @custom:interaction (only reads or writes trades, and is marked `nonReentrant`)
    // checks:
    //   !paused, !frozen
    //   trade[sell].canSettle()
    // actions:
    //   trade[sell].settle()
    // effects:
    //   trades.set(sell, 0)
    //   tradesOpen' = tradesOpen - 1
    function settleTrade(IERC20 sell) external notPausedOrFrozen nonReentrant {
        ITrade trade = trades[sell];
        if (address(trade) == address(0)) return;
        require(trade.canSettle(), "cannot settle yet");

        delete trades[sell];
        tradesOpen--;

        // == Interactions ==
        (uint256 soldAmt, uint256 boughtAmt) = trade.settle();
        emit TradeSettled(trade, trade.sell(), trade.buy(), soldAmt, boughtAmt);
    }

    /// Claim all rewards and sweep to BackingManager
    /// Collective Action
    /// @custom:interaction CEI
    function claimAndSweepRewards() external notPausedOrFrozen {
        // == Interaction ==
        RewardableLibP1.claimAndSweepRewards();
    }

    /// Try to initiate a trade with a trading partner provided by the broker
    /// @custom:interaction (only reads or writes `trades`, and is marked `nonReentrant`)
    // checks:
    //   (not external, so isn't the site for auth or pause checks)
    //   trades[req.sell] == 0
    // actions:
    //   req.sell.increaseAllowance(broker, req.sellAmount)
    //   tradeID = broker.openTrade(req)
    // effects:
    //   trades' = trades.set(req.sell, tradeID)
    //   tradesOpen' = tradesOpen + 1
    function tryTrade(TradeRequest memory req) internal nonReentrant {
        /*  */
        IERC20 sell = req.sell.erc20();
        assert(address(trades[sell]) == address(0));

        IERC20Upgradeable(address(sell)).safeIncreaseAllowance(
            address(main.broker()),
            req.sellAmount
        );
        ITrade trade = main.broker().openTrade(req);

        trades[sell] = trade;
        tradesOpen++;
        emit TradeStarted(trade, sell, req.buy.erc20(), req.sellAmount, req.minBuyAmount);
    }

    // === Setters ===

    /// @custom:governance
    function setMaxTradeSlippage(uint192 val) public governance {
        require(val > 0 && val <= MAX_TRADE_SLIPPAGE, "invalid maxTradeSlippage");
        emit MaxTradeSlippageSet(maxTradeSlippage, val);
        maxTradeSlippage = val;
    }

    /// @custom:governance
    function setMinTradeVolume(uint192 val) public governance {
        require(val <= MIN_TRADE_VOLUME, "invalid minTradeVolume");
        emit MinTradeVolumeSet(minTradeVolume, val);
        minTradeVolume = val;
    }

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[47] private __gap;
}
