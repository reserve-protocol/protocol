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
    using FixLib for int192;
    using SafeERC20 for IERC20Metadata;

    // All trades
    ITrade[] public trades;

    // First trade that is still open (or trades.length if all trades are settled)
    uint256 public tradesStart;

    // The latest end time for any trade in `trades`.
    uint256 private latestEndtime;

    // === Governance params ===
    int192 public maxTradeSlippage; // {%}
    int192 public dustAmount; // {UoA}

    // solhint-disable-next-line func-name-mixedcase
    function __Trading_init(int192 maxTradeSlippage_, int192 dustAmount_)
        internal
        onlyInitializing
    {
        maxTradeSlippage = maxTradeSlippage_;
        dustAmount = dustAmount_;
    }

    /// @return true iff this trader now has open trades.
    function hasOpenTrades() public view returns (bool) {
        return trades.length > tradesStart;
    }

    // @return The length of the trades array
    function numTrades() public view returns (uint256) {
        return trades.length;
    }

    /// Settle any trades that can be settled
    /// @custom:refresher
    function settleTrades() external {
        uint256 i = tradesStart;
        for (; i < trades.length && trades[i].canSettle(); i++) {
            ITrade trade = trades[i];
            try trade.settle() returns (uint256 soldAmt, uint256 boughtAmt) {
                emit TradeSettled(i, trade.sell(), trade.buy(), soldAmt, boughtAmt);
            } catch {
                // Pass over the Trade so it does not block future trading
                emit TradeSettlementBlocked(i);
            }
        }
        tradesStart = i;
    }

    /// Try to initiate a trade with a trading partner provided by the broker
    /// @dev Can fail silently if broker is disable or reverting
    function tryTrade(TradeRequest memory req) internal {
        IAssetRegistry reg = main.assetRegistry();
        assert(reg.isRegistered(req.sell.erc20()) && reg.isRegistered(req.buy.erc20()));

        IBroker broker = main.broker();
        if (broker.disabled()) return; // correct interaction with BackingManager/RevenueTrader

        req.sell.erc20().safeApprove(address(broker), req.sellAmount);
        try broker.openTrade(req) returns (ITrade trade) {
            if (trade.endTime() > latestEndtime) latestEndtime = trade.endTime();

            trades.push(trade);
            uint256 i = trades.length - 1;
            emit TradeStarted(
                i,
                req.sell.erc20(),
                req.buy.erc20(),
                req.sellAmount,
                req.minBuyAmount
            );
        } catch {
            emit TradeBlocked(req.sell.erc20(), req.buy.erc20(), req.sellAmount, req.minBuyAmount);
            req.sell.erc20().safeApprove(address(broker), 0);
        }
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
