// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/Multicall.sol";
import "../../libraries/DutchAuctionLib.sol";
import "../../interfaces/ITrade.sol";
import "../../interfaces/ITrading.sol";
import "../../libraries/Fixed.sol";
import "./Component.sol";
import "./RewardableLib.sol";

/// Abstract trading mixin for all Traders: BackingManager + RevenueTrader
/// @dev See docs/security for discussion of Multicall safety
abstract contract TradingP1 is Multicall, ComponentP1, ReentrancyGuardUpgradeable, ITrading {
    using DutchAuctionLib for DutchAuction;
    using FixLib for uint192;
    using SafeERC20 for IERC20;

    uint192 public constant MAX_TRADE_VOLUME = 1e29; // {UoA}
    uint192 public constant MAX_TRADE_SLIPPAGE = 1e18; // {1}
    uint48 public constant MAX_DUTCH_AUCTION_LENGTH = 86400; // {s} 24h

    // Peer contracts, immutable after init()
    IBroker private broker;

    // All open trades
    mapping(IERC20 => ITrade) public trades;
    uint48 public tradesOpen;

    // === Governance param ===
    uint192 public maxTradeSlippage; // {1}

    uint192 public minTradeVolume; // {UoA}

    // === Added in 3.0.0 ===

    // {s} the length of the implicit falling-price dutch auction
    uint48 public dutchAuctionLength;

    // At the start of a tx, tradeEnd can be:
    //   1. more than dutchAuctionLength away => No dutch auction ongoing
    //   2. within dutchAuctionLength in the past => Dutch auction with 0 bids ongoing
    //   3. within dutchAuctionLength in the future => Dutch auction with 1+ bids ongoing
    // [X, Y): inclusive on the left-bound and exclusive on the right-bound
    uint48 internal tradeEnd; // {s} timestamp of the end of the last trade (batch OR dutch)

    IFurnace internal furnace; // main.furnace() cache

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
        uint192 minTradeVolume_,
        uint48 dutchAuctionLength_
    ) internal onlyInitializing {
        broker = main_.broker();
        furnace = main_.furnace();
        setMaxTradeSlippage(maxTradeSlippage_);
        setMinTradeVolume(minTradeVolume_);
        setDutchAuctionLength(dutchAuctionLength_);
    }

    /// Settle a single trade, expected to be used with multicall for efficient mass settlement
    /// @custom:interaction (only reads or writes trades, and is marked `nonReentrant`)
    // checks:
    //   !paused (trading), !frozen
    //   trade[sell].canSettle()
    // actions:
    //   trade[sell].settle()
    // effects:
    //   trades.set(sell, 0)
    //   tradesOpen' = tradesOpen - 1
    // untested:
    //      OZ nonReentrant line is assumed to be working. cost/benefit of direct testing is high
    function settleTrade(IERC20 sell) public virtual nonReentrant {
        requireNotTradingPausedOrFrozen();
        ITrade trade = trades[sell];
        if (address(trade) == address(0)) return;
        require(trade.canSettle(), "cannot settle yet");

        delete trades[sell];
        tradesOpen--;

        // safely reset tradeEnd
        if (tradeEnd + dutchAuctionLength <= block.timestamp) {
            tradeEnd = uint48(block.timestamp); // allows first bid to happen this block
        }

        // == Interactions ==
        (uint256 soldAmt, uint256 boughtAmt) = trade.settle();
        emit TradeSettled(trade, trade.sell(), trade.buy(), soldAmt, boughtAmt);
    }

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

    /// Try to initiate a trade with a trading partner provided by the broker
    /// @custom:interaction (only reads or writes `trades`, and is marked `nonReentrant`)
    // checks:
    //   (not external, so we don't need auth or pause checks)
    //   trades[req.sell] == 0
    // actions:
    //   req.sell.increaseAllowance(broker, req.sellAmount) - two safeApprove calls to support USDT
    //   tradeID = broker.openTrade(req)
    // effects:
    //   trades' = trades.set(req.sell, tradeID)
    //   tradesOpen' = tradesOpen + 1
    //
    // untested:
    //      OZ nonReentrant line is assumed to be working. cost/benefit of direct testing is high
    // This is reentrancy-safe because we're using the `nonReentrant` modifier on every method of
    // this contract that changes state this function refers to.
    // slither-disable-next-line reentrancy-vulnerabilities-1
    function openTrade(TradeRequest memory req) internal nonReentrant {
        IERC20 sell = req.sell.erc20();
        assert(address(trades[sell]) == address(0));

        IERC20(address(sell)).safeApprove(address(broker), 0);
        IERC20(address(sell)).safeApprove(address(broker), req.sellAmount);
        ITrade trade = broker.openTrade(req);

        trades[sell] = trade;
        tradesOpen++;
        emit TradeStarted(trade, sell, req.buy.erc20(), req.sellAmount, req.minBuyAmount);
    }

    /// Execute a swap of tokenIn for tokenOut based on a dutch auction pricing model
    /// @dev Caller must have granted tokenIn allowances for required tokenIn bal
    /// @dev To get required tokenIn bal, use ethers.callstatic and look at the swap's buyAmount
    /// @param amountOut {qTokenOut} The exact quantity of tokenOut being purchased
    /// @return The exact Swap performed
    function executeSwap(DutchAuction storage auction, uint256 amountOut)
        internal
        returns (Swap memory)
    {
        // Complete bid + execute swap
        return
            auction.bid(
                progression(),
                shiftl_toFix(amountOut, -int8(auction.sell.erc20Decimals()))
            );
    }

    /// @return {1} The % progression of an ongoing dutch auction
    function progression() internal view returns (uint192) {
        return divuu(uint48(block.timestamp) + dutchAuctionLength - tradeEnd, dutchAuctionLength);
    }

    // solhint-disable no-empty-blocks
    // contract-size saver: trades off contract size against execution cost

    function requireGovernance() internal view governance {}

    function requireNotTradingPausedOrFrozen() internal view notTradingPausedOrFrozen {}

    // solhint-enable no-empty-blocks

    // === Setters ===

    /// @custom:governance
    function setMaxTradeSlippage(uint192 val) public {
        requireGovernance();
        require(val < MAX_TRADE_SLIPPAGE, "invalid maxTradeSlippage");
        emit MaxTradeSlippageSet(maxTradeSlippage, val);
        maxTradeSlippage = val;
    }

    /// @custom:governance
    function setMinTradeVolume(uint192 val) public {
        requireGovernance();
        require(val <= MAX_TRADE_VOLUME, "invalid minTradeVolume");
        emit MinTradeVolumeSet(minTradeVolume, val);
        minTradeVolume = val;
    }

    /// @custom:governance
    function setDutchAuctionLength(uint48 val) public {
        requireGovernance();
        require(val <= MAX_DUTCH_AUCTION_LENGTH, "invalid dutchAuctionLength");
        emit DutchAuctionLengthSet(dutchAuctionLength, val);
        dutchAuctionLength = val;
    }

    /// Set the cached furnace variable
    /// @dev RTokens upgrading to 3.0.0: all trading will revert until this is called
    function cacheFurnace() public {
        furnace = main.furnace();
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

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[45] private __gap;
}
