// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/interfaces/IBroker.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/interfaces/ITrade.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/p0/mixins/Rewardable.sol";

/// Abstract trading mixin for all Traders, to be paired with TradingLib
abstract contract TradingP0 is RewardableP0, ITrading {
    using FixLib for uint192;
    using SafeERC20 for IERC20Metadata;

    uint192 public constant MAX_DUST_AMOUNT = 1e29; // {UoA}
    uint192 public constant MAX_TRADE_SLIPPAGE = 1e18; // {%}

    // All trades
    mapping(IERC20 => ITrade) public trades;
    uint48 public tradesOpen;

    // The latest end time for any trade in `trades`.
    uint48 private latestEndtime;

    // === Governance params ===
    uint192 public maxTradeSlippage; // {%}

    // solhint-disable-next-line func-name-mixedcase
    function __Trading_init(uint192 maxTradeSlippage_) internal onlyInitializing {
        setMaxTradeSlippage(maxTradeSlippage_);
    }

    /// Settle a single trade, expected to be used with multicall for efficient mass settlement
    /// @custom:interaction
    function settleTrade(IERC20 sell) public notPausedOrFrozen {
        ITrade trade = trades[sell];
        if (address(trade) == address(0)) return;
        require(trade.canSettle(), "cannot settle yet");

        delete trades[sell];
        tradesOpen--;
        (uint256 soldAmt, uint256 boughtAmt) = trade.settle();
        emit TradeSettled(trade, trade.sell(), trade.buy(), soldAmt, boughtAmt);
    }

    /// Try to initiate a trade with a trading partner provided by the broker
    function tryTrade(TradeRequest memory req) internal {
        IBroker broker = main.broker();
        require(address(trades[req.sell.erc20()]) == address(0), "trade already open");
        require(!broker.disabled(), "broker disabled");

        req.sell.erc20().safeIncreaseAllowance(address(broker), req.sellAmount);
        ITrade trade = broker.openTrade(req);

        if (trade.endTime() > latestEndtime) latestEndtime = trade.endTime();
        trades[req.sell.erc20()] = trade;
        tradesOpen++;
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
        require(val <= MAX_TRADE_SLIPPAGE, "invalid maxTradeSlippage");
        emit MaxTradeSlippageSet(maxTradeSlippage, val);
        maxTradeSlippage = val;
    }
}
