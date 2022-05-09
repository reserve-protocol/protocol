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
    /// @custom:refresher
    function settleTrade(IERC20 sell) public nonReentrant {
        ITrade trade = trades[sell];
        if (address(trade) == address(0)) return;
        require(trade.canSettle(), "cannot settle yet");

        delete trades[sell];
        tradesOpen--;
        (uint256 soldAmt, uint256 boughtAmt) = trade.settle();
        emit TradeSettled(trade.sell(), trade.buy(), soldAmt, boughtAmt);
    }

    /// Try to initiate a trade with a trading partner provided by the broker
    function tryTrade(TradeRequest memory req) internal {
        require(address(trades[req.sell.erc20()]) == address(0), "trade already open");

        IERC20Upgradeable(address(req.sell.erc20())).approve(
            address(main.broker()),
            req.sellAmount
        );
        ITrade trade = main.broker().openTrade(req);

        if (trade.endTime() > latestEndtime) latestEndtime = trade.endTime();
        trades[req.sell.erc20()] = trade;
        tradesOpen++;
        emit TradeStarted(req.sell.erc20(), req.buy.erc20(), req.sellAmount, req.minBuyAmount);
    }

    /// Claim all rewards and sweep to BackingManager
    /// Collective Action
    function claimAndSweepRewards() external nonReentrant {
        RewardableLibP1.claimAndSweepRewards();
    }

    // === Setters ===

    function setMaxTradeSlippage(int192 val) external onlyOwner {
        emit MaxTradeSlippageSet(maxTradeSlippage, val);
        maxTradeSlippage = val;
    }

    function setDustAmount(int192 val) external onlyOwner {
        emit DustAmountSet(dustAmount, val);
        dustAmount = val;
    }
}
