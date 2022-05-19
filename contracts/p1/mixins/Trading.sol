// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

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
abstract contract TradingP1 is Multicall, ComponentP1, ITrading {
    using FixLib for int192;
    using SafeERC20Upgradeable for IERC20Upgradeable;

    // All trades
    mapping(IERC20 => ITrade) public trades;
    uint32 public tradesOpen;
    // tradesOpen is correct iff then tradesOpen is the number of values in `trades`
    // that aren't set to address(0) or address(1).

    // === Governance params ===
    int192 public maxTradeSlippage; // {%}
    int192 public dustAmount; // {UoA}

    // The latest end time for any trade in `trades`.
    uint32 private latestEndtime;

    // solhint-disable-next-line func-name-mixedcase
    function __Trading_init(int192 maxTradeSlippage_, int192 dustAmount_)
        internal
        onlyInitializing
    {
        maxTradeSlippage = maxTradeSlippage_;
        dustAmount = dustAmount_;
    }

    /// Settle a single trade, expected to be used with multicall for efficient mass settlement
    /// @custom:interaction , CEI
    function settleTrade(IERC20 sell) external interaction {
        ITrade trade = trades[sell];
        if (address(trade) == address(0) || address(trade) == address(1)) return;
        require(trade.canSettle(), "cannot settle yet");

        delete trades[sell];
        tradesOpen--;

        // == Interactions ==
        (uint256 soldAmt, uint256 boughtAmt) = trade.settle();
        emit TradeSettled(trade.sell(), trade.buy(), soldAmt, boughtAmt);
    }

    /// Claim all rewards and sweep to BackingManager
    /// Collective Action
    /// @custom:interaction , CEI
    function claimAndSweepRewards() external interaction {
        // == Interaction ==
        RewardableLibP1.claimAndSweepRewards();
    }

    /// Try to initiate a trade with a trading partner provided by the broker
    /// @custom:interaction , Not CEI pattern. Instead, we avoid reentrancy attacks by:
    /// - using a lock value (address(1)) in trades[sell]
    /// - honoring that lock everywhere else that trades[sell] may be written
    ///   (i.e, in settleTrade())
    function tryTrade(TradeRequest memory req) internal {
        // == Checks-Effects block 1 ==
        IERC20 sell = req.sell.erc20();
        require(address(trades[sell]) == address(0), "trade already open");
        trades[sell] = ITrade(address(1)); // Prevent reentrant writes trades[req.sell.erc20()]

        // == Interactions ==
        IERC20Upgradeable(address(sell)).approve(address(main.broker()), req.sellAmount);
        ITrade trade = main.broker().openTrade(req);

        // == Checks-Effects block 2 ==
        if (trade.endTime() > latestEndtime) latestEndtime = trade.endTime();
        trades[sell] = trade;
        tradesOpen++;
        emit TradeStarted(sell, req.buy.erc20(), req.sellAmount, req.minBuyAmount);
    }

    // === Setters ===

    /// @custom:governance
    function setMaxTradeSlippage(int192 val) external governance {
        emit MaxTradeSlippageSet(maxTradeSlippage, val);
        maxTradeSlippage = val;
    }

    /// @custom:governance
    function setDustAmount(int192 val) external governance {
        emit DustAmountSet(dustAmount, val);
        dustAmount = val;
    }
}
