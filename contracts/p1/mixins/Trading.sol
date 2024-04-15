// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../../interfaces/ITrade.sol";
import "../../interfaces/ITrading.sol";
import "../../libraries/Allowance.sol";
import "../../libraries/Fixed.sol";
import "../../vendor/oz/Multicall.sol";
import "./Component.sol";
import "./RewardableLib.sol";

/// Abstract trading mixin for BackingManager + RevenueTrader.
/// @dev The use of Multicall here instead of MulticallUpgradeable cannot be
///   changed without breaking <3.0.0 RTokens. The only difference in
///   MulticallUpgradeable is the 50 slot storage gap and an empty constructor.
///   It should be fine to leave the non-upgradeable Multicall here permanently.
abstract contract TradingP1 is Multicall, ComponentP1, ReentrancyGuardUpgradeable, ITrading {
    using FixLib for uint192;

    uint192 public constant MAX_TRADE_VOLUME = 1e29; // {UoA}
    uint192 public constant MAX_TRADE_SLIPPAGE = 1e18; // {%}

    // Peer contracts, immutable after init()
    IBroker private broker;

    // All open trades
    mapping(IERC20 => ITrade) public trades;
    uint48 public tradesOpen;

    // === Governance param ===
    uint192 public maxTradeSlippage; // {%}
    uint192 public minTradeVolume; // {UoA}

    // === 3.0.0 ===
    uint256 public tradesNonce; // to keep track of how many trades have been opened in total

    // ==== Invariants ====
    // tradesOpen = len(values(trades))
    // trades[sell] != 0 iff trade[sell] has been opened and not yet settled

    // untestable:
    //      `else` branch of `onlyInitializing` (ie. revert) is currently untestable.
    //      This function is only called inside other `init` functions, each of which is wrapped
    //      in an `initializer` modifier, which would fail first.
    // solhint-disable-next-line func-name-mixedcase
    function __Trading_init(
        IMain main_,
        uint192 maxTradeSlippage_,
        uint192 minTradeVolume_
    ) internal onlyInitializing {
        broker = main_.broker();
        setMaxTradeSlippage(maxTradeSlippage_);
        setMinTradeVolume(minTradeVolume_);
    }

    /// Contract-size helper
    // solhint-disable-next-line no-empty-blocks
    function requireNotTradingPausedOrFrozen() internal view notTradingPausedOrFrozen {}

    /// Claim all rewards
    /// Collective Action
    /// @custom:interaction CEI
    function claimRewards() external {
        requireNotTradingPausedOrFrozen();
        RewardableLibP1.claimRewards(main.assetRegistry());
    }

    /// Claim rewards for a single asset
    /// Collective Action
    /// @param erc20 The ERC20 to claimRewards on
    /// @custom:interaction CEI
    function claimRewardsSingle(IERC20 erc20) external {
        requireNotTradingPausedOrFrozen();
        RewardableLibP1.claimRewardsSingle(main.assetRegistry().toAsset(erc20));
    }

    /// Settle a single trade, expected to be used with multicall for efficient mass settlement
    /// @param sell The sell token in the trade
    /// @return trade The ITrade contract settled
    /// @custom:interaction (only reads or writes trades, and is marked `nonReentrant`)
    // checks:
    //   !paused (trading), !frozen
    //   trade[sell].canSettle()
    //   (see override)
    // actions:
    //   trade[sell].settle()
    // effects:
    //   trades.set(sell, 0)
    //   tradesOpen' = tradesOpen - 1
    // untested:
    //      OZ nonReentrant line is assumed to be working. cost/benefit of direct testing is high
    function settleTrade(IERC20 sell) public virtual nonReentrant returns (ITrade trade) {
        trade = trades[sell];
        require(address(trade) != address(0), "no trade open");
        require(trade.canSettle(), "cannot settle yet");

        delete trades[sell];
        tradesOpen--;

        // == Interactions ==
        (uint256 soldAmt, uint256 boughtAmt) = trade.settle();
        emit TradeSettled(trade, sell, trade.buy(), soldAmt, boughtAmt);
    }

    /// Try to initiate a trade with a trading partner provided by the broker
    /// @param kind TradeKind.DUTCH_AUCTION or TradeKind.BATCH_AUCTION
    /// @return trade The trade contract created
    /// @custom:interaction Assumption: Caller is nonReentrant
    // checks:
    //   (not external, so we don't need auth or pause checks)
    //   trades[req.sell] == 0
    // actions:
    //   req.sell.increaseAllowance(broker, req.sellAmount) - two safeApprove calls to support USDT
    //   tradeID = broker.openTrade(req)
    // effects:
    //   trades' = trades.set(req.sell, tradeID)
    //   tradesOpen' = tradesOpen + 1
    function tryTrade(
        TradeKind kind,
        TradeRequest memory req,
        TradePrices memory prices
    ) internal returns (ITrade trade) {
        IERC20 sell = req.sell.erc20();
        assert(address(trades[sell]) == address(0)); // ensure calling class has checked this

        // Set allowance via custom approval -- first sets allowance to 0, then sets allowance
        // to either the requested amount or the maximum possible amount, if that fails.
        //
        // Context: wcUSDCv3 has a non-standard approve() function that reverts if the approve
        // amount is > 0 and < type(uint256).max.
        AllowanceLib.safeApproveFallbackToMax(address(sell), address(broker), req.sellAmount);

        trade = broker.openTrade(kind, req, prices);
        trades[sell] = trade;
        ++tradesOpen;
        ++tradesNonce;

        emit TradeStarted(trade, sell, req.buy.erc20(), req.sellAmount, req.minBuyAmount);
    }

    // === Setters ===

    /// @custom:governance
    function setMaxTradeSlippage(uint192 val) public governance {
        require(val < MAX_TRADE_SLIPPAGE, "invalid maxTradeSlippage");
        emit MaxTradeSlippageSet(maxTradeSlippage, val);
        maxTradeSlippage = val;
    }

    /// @custom:governance
    function setMinTradeVolume(uint192 val) public governance {
        require(val <= MAX_TRADE_VOLUME, "invalid minTradeVolume");
        emit MinTradeVolumeSet(minTradeVolume, val);
        minTradeVolume = val;
    }

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[45] private __gap;
}
