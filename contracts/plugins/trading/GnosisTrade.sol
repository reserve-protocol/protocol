// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "../../libraries/Fixed.sol";
import "../../interfaces/IBroker.sol";
import "../../interfaces/IGnosis.sol";
import "../../interfaces/ITrade.sol";

enum TradeStatus {
    NOT_STARTED, // before init()
    OPEN, // after init() and before settle()
    CLOSED, // after settle()
    PENDING // during init() or settle() (reentrancy protection)
}

// Modifications to this contract's state must only ever be made when status=PENDING!

/// Trade contract against the Gnosis EasyAuction mechanism
contract GnosisTrade is ITrade {
    using FixLib for uint192;
    using SafeERC20Upgradeable for IERC20Upgradeable;

    // ==== Constants
    uint256 public constant FEE_DENOMINATOR = 1000;

    // Upper bound for the max number of orders we're happy to have the auction clear in;
    // When we have good price information, this determines the minimum buy amount per order.
    uint96 public constant MAX_ORDERS = 1e5;

    // raw "/" for compile-time const
    uint192 public constant DEFAULT_MIN_BID = FIX_ONE / 100; // {tok}

    // ==== status: This contract's state-machine state. See TradeStatus enum, above
    TradeStatus public status;

    // ==== The rest of contract state is all parameters that are immutable after init()
    // == Metadata
    IGnosis public gnosis; // Gnosis Auction contract
    uint256 public auctionId; // The Gnosis Auction ID returned by gnosis.initiateAuction()
    IBroker public broker; // The Broker that cloned this contract into existence

    // == Economic parameters
    // This trade is on behalf of origin. Only origin may call settle(), and the `buy` tokens
    // from this trade's acution will all eventually go to origin.
    address public origin;
    IERC20Metadata public sell; // address of token this trade is selling
    IERC20Metadata public buy; // address of token this trade is buying
    uint256 public initBal; // {qTok}, this trade's balance of `sell` when init() was called
    uint48 public endTime; // timestamp after which this trade's auction can be settled
    uint192 public worstCasePrice; // {buyTok/sellTok}, the worst price we expect to get at Auction
    // We expect Gnosis Auction either to meet or beat worstCasePrice, or to return the `sell`
    // tokens. If we actually *get* a worse clearing that worstCasePrice, we consider it an error in
    // our trading scheme and call broker.reportViolation()

    // This modifier both enforces the state-machine pattern and guards against reentrancy.
    modifier stateTransition(TradeStatus begin, TradeStatus end) {
        require(status == begin, "Invalid trade state");
        status = TradeStatus.PENDING;
        _;
        assert(status == TradeStatus.PENDING);
        status = end;
    }

    /// Constructor function, can only be called once
    /// @dev Expects sell tokens to already be present
    /// @custom:interaction reentrancy-safe b/c state-locking
    // checks:
    //   state is NOT_STARTED
    //   req.sellAmount <= our balance of sell tokens < 2**96
    //   req.minBuyAmount < 2**96
    // effects:
    //   state' is OPEN
    //   correctly sets all Metadata and Economic parameters of this contract
    //
    // actions:
    //   increases the `req.sell` allowance for `gnosis` by the amount needed to fund the auction
    //   calls gnosis.initiateAuction(...) to launch the requested auction.
    function init(
        IBroker broker_,
        address origin_,
        IGnosis gnosis_,
        uint48 auctionLength,
        TradeRequest calldata req
    ) external stateTransition(TradeStatus.NOT_STARTED, TradeStatus.OPEN) {
        require(req.sellAmount <= type(uint96).max, "sellAmount too large");
        require(req.minBuyAmount <= type(uint96).max, "minBuyAmount too large");

        sell = req.sell.erc20();
        buy = req.buy.erc20();
        initBal = sell.balanceOf(address(this));

        require(initBal <= type(uint96).max, "initBal too large");
        require(initBal >= req.sellAmount, "unfunded trade");

        assert(origin_ != address(0));

        broker = broker_;
        origin = origin_;
        gnosis = gnosis_;
        endTime = uint48(block.timestamp) + auctionLength;

        // {buyTok/sellTok}
        worstCasePrice = shiftl_toFix(req.minBuyAmount, -int8(buy.decimals())).div(
            shiftl_toFix(req.sellAmount, -int8(sell.decimals()))
        );

        // Downsize our sell amount to adjust for fee
        // {qTok} = {qTok} * {1} / {1}
        uint96 sellAmount = uint96(
            _divrnd(
                req.sellAmount * FEE_DENOMINATOR,
                FEE_DENOMINATOR + gnosis.feeNumerator(),
                FLOOR
            )
        );

        // Don't decrease minBuyAmount even if fees are in effect. The fee is part of the slippage
        uint96 minBuyAmount = uint96(Math.max(1, req.minBuyAmount)); // Safe downcast; require'd

        uint256 minBuyAmtPerOrder = Math.max(
            minBuyAmount / MAX_ORDERS,
            DEFAULT_MIN_BID.shiftl_toUint(int8(buy.decimals()))
        );

        // Gnosis EasyAuction requires minBuyAmtPerOrder > 0
        // untestable:
        //      Value will always be at least 1. Handled previously in the calling contracts.
        if (minBuyAmtPerOrder == 0) minBuyAmtPerOrder = 1;

        // == Interactions ==

        // Set allowance (two safeApprove calls to support USDT)
        IERC20Upgradeable(address(sell)).safeApprove(address(gnosis), 0);
        IERC20Upgradeable(address(sell)).safeApprove(address(gnosis), initBal);

        auctionId = gnosis.initiateAuction(
            sell,
            buy,
            endTime,
            endTime,
            sellAmount,
            minBuyAmount,
            minBuyAmtPerOrder,
            0,
            false,
            address(0),
            new bytes(0)
        );
    }

    /// Settle trade, transfer tokens to trader, and report bad trade if needed
    /// @custom:interaction reentrancy-safe b/c state-locking
    // checks:
    //   state is OPEN
    //   caller is `origin`
    //   now >= endTime
    // actions:
    //   (if not already called) call gnosis.settleAuction(auctionID), which:
    //     settles the Gnosis Auction
    //     transfers the resulting tokens back to this address
    //   if the auction's clearing price was below what we assert it should be,
    //     then broker.reportViolation()
    //   transfer all balancess of `buy` and `sell` at this address to `origin`
    // effects:
    //   state' is CLOSED
    function settle()
        external
        stateTransition(TradeStatus.OPEN, TradeStatus.CLOSED)
        returns (uint256 soldAmt, uint256 boughtAmt)
    {
        require(msg.sender == origin, "only origin can settle");

        // Optionally process settlement of the auction in Gnosis
        if (!isAuctionCleared()) {
            // By design, we don't rely on this return value at all, just the
            // "cleared" state of the auction, and the token balances this contract owns.
            // slither-disable-next-line unused-return
            gnosis.settleAuction(auctionId);
            assert(isAuctionCleared());
        }

        // At this point we know the auction has cleared

        // Transfer balances to origin
        uint256 sellBal = sell.balanceOf(address(this));
        boughtAmt = buy.balanceOf(address(this));

        if (sellBal > 0) IERC20Upgradeable(address(sell)).safeTransfer(origin, sellBal);
        if (boughtAmt > 0) IERC20Upgradeable(address(buy)).safeTransfer(origin, boughtAmt);

        // Check clearing prices
        if (sellBal < initBal) {
            soldAmt = initBal - sellBal;

            // Gnosis rounds defensively in the buy token; we should not consider it a violation
            uint256 adjustedSoldAmt = Math.max(soldAmt, 1);
            uint256 adjustedBuyAmt = boughtAmt + 1;

            // {buyTok/sellTok}
            uint192 clearingPrice = shiftl_toFix(adjustedBuyAmt, -int8(buy.decimals())).div(
                shiftl_toFix(adjustedSoldAmt, -int8(sell.decimals()))
            );

            if (clearingPrice.lt(worstCasePrice)) {
                broker.reportViolation();
            }
        }
    }

    /// Anyone can transfer any ERC20 back to the origin after the trade has been closed
    /// @dev Escape hatch in case trading partner freezes up, or other unexpected events
    /// @custom:interaction CEI (and respects the state lock)
    function transferToOriginAfterTradeComplete(IERC20 erc20) external {
        require(status == TradeStatus.CLOSED, "only after trade is closed");
        IERC20Upgradeable(address(erc20)).safeTransfer(origin, erc20.balanceOf(address(this)));
    }

    /// @return True if the trade can be settled.
    // Guaranteed to be true some time after init(), until settle() is called
    function canSettle() external view returns (bool) {
        return status == TradeStatus.OPEN && endTime <= block.timestamp;
    }

    // === Private ===

    function isAuctionCleared() private view returns (bool) {
        GnosisAuctionData memory data = gnosis.auctionData(auctionId);
        return data.clearingPriceOrder != bytes32(0);
    }
}
