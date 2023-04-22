// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../../libraries/DutchAuctionLib.sol";
import "../../interfaces/IBroker.sol";
import "../../interfaces/IMain.sol";
import "../../interfaces/ITrade.sol";
import "../../libraries/Fixed.sol";
import "./Rewardable.sol";

/// Abstract trading mixin for all Traders, to be paired with TradingLib
abstract contract TradingP0 is RewardableP0, ITrading {
    using DutchAuctionLib for DutchAuction;
    using FixLib for uint192;
    using SafeERC20 for IERC20Metadata;

    uint192 public constant MAX_TRADE_VOLUME = 1e29; // {UoA}
    uint192 public constant MAX_TRADE_SLIPPAGE = 1e18; // {%}
    uint48 public constant MAX_DUTCH_AUCTION_LENGTH = 86400; // {s} 24h

    // All trades
    mapping(IERC20 => ITrade) public trades;
    uint48 public tradesOpen;

    // === Governance params ===
    uint192 public maxTradeSlippage; // {%}

    uint192 public minTradeVolume; // {UoA}

    // {s} the length of the implicit falling-price dutch auction
    uint48 public dutchAuctionLength;

    // At the start of a tx, tradeEnd can be:
    //   1. more than dutchAuctionLength away => No dutch auction ongoing
    //   2. within dutchAuctionLength in the past => Dutch auction with 0 bids ongoing
    //   3. within dutchAuctionLength in the future => Dutch auction with 1+ bids ongoing
    // [X, Y): inclusive on the left-bound and exclusive on the right-bound
    uint48 internal tradeEnd; // {s} timestamp of the end of the last trade (batch OR dutch)

    // untestable:
    //      `else` branch of `onlyInitializing` (ie. revert) is currently untestable.
    //      This function is only called inside other `init` functions, each of which is wrapped
    //      in an `initializer` modifier, which would fail first.
    // solhint-disable-next-line func-name-mixedcase
    function __Trading_init(
        uint192 maxTradeSlippage_,
        uint192 minTradeVolume_,
        uint48 dutchAuctionLength_
    ) internal onlyInitializing {
        setMaxTradeSlippage(maxTradeSlippage_);
        setMinTradeVolume(minTradeVolume_);
        setDutchAuctionLength(dutchAuctionLength_);
    }

    /// Settle a single trade, expected to be used with multicall for efficient mass settlement
    /// @custom:interaction
    function settleTrade(IERC20 sell) external virtual notTradingPausedOrFrozen {
        ITrade trade = trades[sell];
        if (address(trade) == address(0)) return;
        require(trade.canSettle(), "cannot settle yet");

        delete trades[sell];
        tradesOpen--;

        // safely reset tradeEnd
        if (tradeEnd + dutchAuctionLength <= block.timestamp) {
            tradeEnd = uint48(block.timestamp - 1); // this allows first bid to happen this block
        }

        (uint256 soldAmt, uint256 boughtAmt) = trade.settle();
        emit TradeSettled(trade, trade.sell(), trade.buy(), soldAmt, boughtAmt);
    }

    /// Try to initiate a trade with a trading partner provided by the broker
    function openTrade(TradeRequest memory req) internal {
        IBroker broker = main.broker();
        assert(address(trades[req.sell.erc20()]) == address(0));
        require(!broker.disabled(), "broker disabled");

        req.sell.erc20().safeApprove(address(broker), 0);
        req.sell.erc20().safeApprove(address(broker), req.sellAmount);

        ITrade trade = broker.openTrade(req);

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

    /// Execute a swap of tokenIn for tokenOut based on a dutch auction pricing model
    /// @dev Caller must have granted tokenIn allowances for required tokenIn bal
    /// @dev To get required tokenIn bal, use ethers.callstatic and look at the swap's buyAmount
    /// @param tokenIn The ERC20 token provided by the caller
    /// @param tokenOut The ERC20 token being purchased by the caller
    /// @param amountOut {qTokenOut} The exact quantity of tokenOut being purchased
    /// @return The exact Swap performed
    function executeSwap(
        DutchAuction storage auction,
        IERC20 tokenIn,
        IERC20 tokenOut,
        uint256 amountOut
    ) internal returns (Swap memory) {
        require(
            auction.buy.erc20() == tokenIn && auction.sell.erc20() == tokenOut,
            "ERC20 mismatch"
        );

        // {sellTok}
        uint192 bidSellAmt = shiftl_toFix(amountOut, -int8(auction.sell.erc20Decimals()));

        // Complete bid + execute swap
        return auction.bid(progression(), bidSellAmt);
    }

    /// @return p {1} The % progression of the auction at a timestamp
    function progression() internal view returns (uint192 p) {
        return divuu(uint48(block.timestamp) + dutchAuctionLength - tradeEnd, dutchAuctionLength);
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

    /// @custom:governance
    function setDutchAuctionLength(uint48 val) public governance {
        require(val <= MAX_DUTCH_AUCTION_LENGTH, "invalid dutchAuctionLength");
        emit DutchAuctionLengthSet(dutchAuctionLength, val);
        dutchAuctionLength = val;
    }

    // === FixLib Helper ===

    /// Light wrapper around FixLib.mulDiv to support try-catch
    function mulDivCeil(
        uint192 x,
        uint192 y,
        uint192 z
    ) external pure returns (uint192) {
        return x.mulDiv(y, z, CEIL);
    }
}
