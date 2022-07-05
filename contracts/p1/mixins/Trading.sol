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

    // All trades
    mapping(IERC20 => ITrade) public trades;
    uint32 public tradesOpen;
    // The number of nonzero values in `trades`

    // === Governance params ===
    uint192 public maxTradeSlippage; // {%}
    uint192 public dustAmount; // {UoA}

    // The latest end time for any trade in `trades`.
    uint32 private latestEndtime;

    // solhint-disable-next-line func-name-mixedcase
    function __Trading_init(uint192 maxTradeSlippage_, uint192 dustAmount_)
        internal
        onlyInitializing
    {
        maxTradeSlippage = maxTradeSlippage_;
        dustAmount = dustAmount_;
    }

    /// Settle a single trade, expected to be used with multicall for efficient mass settlement
    /// @custom:interaction (only reads or writes trades, and is marked `nonReentrant`)
    function settleTrade(IERC20 sell) external notPausedOrFrozen nonReentrant {
        ITrade trade = trades[sell];
        if (address(trade) == address(0)) return;
        require(trade.canSettle(), "cannot settle yet");

        delete trades[sell];
        tradesOpen--;

        // == Interactions ==
        (uint256 soldAmt, uint256 boughtAmt) = trade.settle();
        emit TradeSettled(trade.sell(), trade.buy(), soldAmt, boughtAmt);
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
    function tryTrade(TradeRequest memory req) internal nonReentrant {
        IERC20 sell = req.sell.erc20();
        require(address(trades[sell]) == address(0), "trade already open");

        IERC20Upgradeable(address(sell)).approve(address(main.broker()), req.sellAmount);
        ITrade trade = main.broker().openTrade(req);

        if (trade.endTime() > latestEndtime) latestEndtime = trade.endTime();
        trades[sell] = trade;
        tradesOpen++;
        emit TradeStarted(sell, req.buy.erc20(), req.sellAmount, req.minBuyAmount);
    }

    // === Setters ===

    /// @custom:governance
    function setMaxTradeSlippage(uint192 val) external governance {
        emit MaxTradeSlippageSet(maxTradeSlippage, val);
        maxTradeSlippage = val;
    }

    /// @custom:governance
    function setDustAmount(uint192 val) external governance {
        emit DustAmountSet(dustAmount, val);
        dustAmount = val;
    }
}
