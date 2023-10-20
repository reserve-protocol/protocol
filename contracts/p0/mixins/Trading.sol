// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../../interfaces/IBroker.sol";
import "../../interfaces/IMain.sol";
import "../../interfaces/ITrade.sol";
import "../../libraries/Allowance.sol";
import "../../libraries/Fixed.sol";
import "./Rewardable.sol";

/// Abstract trading mixin for all Traders, to be paired with TradingLib
abstract contract TradingP0 is RewardableP0, ITrading {
    using FixLib for uint192;
    using SafeERC20 for IERC20Metadata;

    uint192 public constant MAX_TRADE_VOLUME = 1e29; // {UoA}
    uint192 public constant MAX_TRADE_SLIPPAGE = 1e18; // {%}

    // All trades
    mapping(IERC20 => ITrade) public trades;
    uint48 public tradesOpen;

    // === Governance params ===
    uint192 public maxTradeSlippage; // {%}

    uint192 public minTradeVolume; // {UoA}

    // === 3.0.0 ===
    uint256 public tradesNonce; // to keep track of how many trades have been opened in total

    // untestable:
    //      `else` branch of `onlyInitializing` (ie. revert) is currently untestable.
    //      This function is only called inside other `init` functions, each of which is wrapped
    //      in an `initializer` modifier, which would fail first.
    // solhint-disable-next-line func-name-mixedcase
    function __Trading_init(uint192 maxTradeSlippage_, uint192 minTradeVolume_)
        internal
        onlyInitializing
    {
        setMaxTradeSlippage(maxTradeSlippage_);
        setMinTradeVolume(minTradeVolume_);
    }

    /// Settle a single trade, expected to be used with multicall for efficient mass settlement
    /// @param sell The sell token in the trade
    /// @return trade The ITrade contract settled
    /// @custom:interaction
    function settleTrade(IERC20 sell) public virtual returns (ITrade trade) {
        trade = trades[sell];
        require(address(trade) != address(0), "no trade open");
        require(trade.canSettle(), "cannot settle yet");

        delete trades[sell];
        tradesOpen--;
        (uint256 soldAmt, uint256 boughtAmt) = trade.settle();
        emit TradeSettled(trade, trade.sell(), trade.buy(), soldAmt, boughtAmt);
    }

    /// Try to initiate a trade with a trading partner provided by the broker
    /// @param kind TradeKind.DUTCH_AUCTION or TradeKind.BATCH_AUCTION
    /// @return trade The trade contract created
    function tryTrade(
        TradeKind kind,
        TradeRequest memory req,
        TradePrices memory prices
    ) internal returns (ITrade trade) {
        IBroker broker = main.broker();
        assert(address(trades[req.sell.erc20()]) == address(0));

        // Set allowance via custom approval -- first sets allowance to 0, then sets allowance
        // to either the requested amount or the maximum possible amount, if that fails.
        //
        // Context: wcUSDCv3 has a non-standard approve() function that reverts if the approve
        // amount is > 0 and < type(uint256).max.
        AllowanceLib.safeApproveFallbackToMax(
            address(req.sell.erc20()),
            address(broker),
            req.sellAmount
        );

        trade = broker.openTrade(kind, req, prices);
        trades[req.sell.erc20()] = trade;
        tradesOpen++;
        tradesNonce++;

        emit TradeStarted(
            trade,
            req.sell.erc20(),
            req.buy.erc20(),
            req.sellAmount,
            req.minBuyAmount
        );
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
}
