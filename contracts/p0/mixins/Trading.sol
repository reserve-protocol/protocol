// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "contracts/interfaces/IBroker.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/interfaces/ITrade.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/p0/mixins/Component.sol";
import "contracts/p0/mixins/Rewardable.sol";

// Abstract trading mixin for all Traders
abstract contract TradingP0 is RewardableP0, ITrading {
    using FixLib for int192;

    // All trades
    ITrade[] public trades;

    // First trade that is still open (or trades.length if all trades are settled)
    uint256 internal tradesStart;

    // The latest end time for any trade in `trades`.
    uint256 private latestEndtime;

    // === Governance params ===
    int192 public maxTradeSlippage; // {%}
    int192 public dustAmount; // {UoA}

    function init(ConstructorArgs calldata args) internal virtual override {
        maxTradeSlippage = args.params.maxTradeSlippage;
        dustAmount = args.params.dustAmount;
    }

    /// @return true iff this trader now has open trades.
    function hasOpenTrades() public view returns (bool) {
        return trades.length > tradesStart;
    }

    /// Settle any trades that can be settled
    /// @custom:refresher
    function settleTrades() public {
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

    /// Prepare an trade to sell `sellAmount` that guarantees a reasonable closing price,
    /// without explicitly aiming at a particular quantity to purchase.
    /// @param sellAmount {sellTok}
    /// @return notDust True when the trade is larger than the dust amount
    /// @return trade The prepared trade
    function prepareTradeSell(
        IAsset sell,
        IAsset buy,
        int192 sellAmount
    ) internal view returns (bool notDust, TradeRequest memory trade) {
        assert(sell.price().neq(FIX_ZERO) && buy.price().neq(FIX_ZERO));
        trade.sell = sell;
        trade.buy = buy;

        // Don't buy dust.
        if (sellAmount.lt(dustThreshold(sell))) return (false, trade);

        // {sellTok}
        int192 fixSellAmount = fixMin(sellAmount, sell.maxAuctionSize().div(sell.price()));
        trade.sellAmount = fixSellAmount.shiftLeft(int8(sell.erc20().decimals())).floor();

        // {buyTok} = {sellTok} * {UoA/sellTok} / {UoA/buyTok}
        int192 exactBuyAmount = fixSellAmount.mul(sell.price()).div(buy.price());
        int192 minBuyAmount = exactBuyAmount.mul(FIX_ONE.minus(maxTradeSlippage));
        trade.minBuyAmount = minBuyAmount.shiftLeft(int8(buy.erc20().decimals())).ceil();
        return (true, trade);
    }

    /// Assuming we have `maxSellAmount` sell tokens avaialable, prepare an trade to
    /// cover as much of our deficit as possible, given expected trade slippage.
    /// @param maxSellAmount {sellTok}
    /// @param deficitAmount {buyTok}
    /// @return notDust Whether the prepared trade is large enough to be worth trading
    /// @return trade The prepared trade
    function prepareTradeToCoverDeficit(
        IAsset sell,
        IAsset buy,
        int192 maxSellAmount,
        int192 deficitAmount
    ) internal view returns (bool notDust, TradeRequest memory trade) {
        // Don't sell dust.
        if (maxSellAmount.lt(dustThreshold(sell))) return (false, trade);

        // Don't buy dust.
        deficitAmount = fixMax(deficitAmount, dustThreshold(buy));

        // {sellTok} = {buyTok} * {UoA/buyTok} / {UoA/sellTok}
        int192 exactSellAmount = deficitAmount.mul(buy.price()).div(sell.price());
        // exactSellAmount: Amount to sell to buy `deficitAmount` if there's no slippage

        // idealSellAmount: Amount needed to sell to buy `deficitAmount`, counting slippage
        int192 idealSellAmount = exactSellAmount.div(FIX_ONE.minus(maxTradeSlippage));

        int192 sellAmount = fixMin(idealSellAmount, maxSellAmount);
        return prepareTradeSell(sell, buy, sellAmount);
    }

    /// @return {tok} The least amount of whole tokens ever worth trying to sell
    function dustThreshold(IAsset asset) internal view returns (int192) {
        // {tok} = {UoA} / {UoA/tok}
        return dustAmount.div(asset.price());
    }

    /// Try to initiate a trade with a trading partner provided by the broker
    /// @dev Can fail silently if broker is disable or reverting
    function tryTradeWithBroker(TradeRequest memory req) internal {
        IBroker broker = main.broker();
        if (broker.disabled()) return; // correct interaction with BackingManager/RevenueTrader

        req.sell.erc20().approve(address(broker), req.sellAmount);
        try broker.openTrade(req) returns (ITrade trade) {
            latestEndtime = Math.max(trade.endTime(), latestEndtime);

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
            req.sell.erc20().approve(address(broker), 0);
            emit TradeBlocked(req.sell.erc20(), req.buy.erc20(), req.sellAmount, req.minBuyAmount);
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
