// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../../libraries/Fixed.sol";
import "../../interfaces/IAsset.sol";
import "../../interfaces/ITrade.sol";

uint192 constant FIFTEEN_PERCENT = 15e16; // {1}
uint192 constant FIFTY_PERCENT = 50e16; // {1}
uint192 constant EIGHTY_FIVE_PERCENT = 85e16; // {1}

/**
 * @title DutchTrade
 * @notice Implements a wholesale dutch auction via a piecewise falling-price mechansim.
 *   Over the first 15% of the auction the price falls from the ~150% pricepoint to the
 *   best price, as given by the price range. Over the last 85% of the auction it falls
 *   from the best price to the worst price. The worst price is additionally discounted by
 *   the maxTradeSlippage based on how far between minTradeVolume and maxTradeVolume the trade is.
 *
 * Flow for bidding:
 * - Call `bidAmount()` to check price at various timestamps
 * - Wait until desirable block is reached
 * - Provide approval for `buy` token in the correct amount
 * - Call `bid()`. Receive payment in sell tokens atomically
 */
contract DutchTrade is ITrade {
    using FixLib for uint192;
    using SafeERC20 for IERC20Metadata;

    TradeStatus public status; // reentrancy protection

    ITrading public origin; // creator

    // === Auction ===
    IERC20Metadata public sell;
    IERC20Metadata public buy;
    uint192 public sellAmount; // {sellTok}

    uint48 public startTime; // timestamp at which the dutch auction began
    uint48 public endTime; // timestamp the dutch auction ends, if no bids have been received

    uint192 public middlePrice; // {buyTok/sellTok} The price at which the function is piecewise
    uint192 public lowPrice; // {buyTok/sellTok} The price the auction ends at
    // highPrice is always 1.5x the middlePrice

    // === Bid ===
    address public bidder;
    // the bid amount is just whatever token balance is in the contract at settlement time

    // This modifier both enforces the state-machine pattern and guards against reentrancy.
    modifier stateTransition(TradeStatus begin, TradeStatus end) {
        require(status == begin, "Invalid trade state");
        status = TradeStatus.PENDING;
        _;
        assert(status == TradeStatus.PENDING);
        status = end;
    }

    /// @param sell_ The asset being sold by the protocol
    /// @param buy_ The asset being bought by the protocol
    /// @param sellAmount_ {sellTok} The amount to sell in the auction, in whole tokens
    /// @param minTradeVolume_ {UoA} The mimimum amount to trade
    /// @param maxTradeSlippage_ {1} An additional discount applied to the auction low price
    /// @param auctionLength {1} An additional discount applied to the auction low price
    function init(
        IAsset sell_,
        IAsset buy_,
        uint192 sellAmount_,
        uint192 minTradeVolume_,
        uint192 maxTradeSlippage_,
        uint48 auctionLength
    ) external stateTransition(TradeStatus.NOT_STARTED, TradeStatus.OPEN) {
        require(address(sell) != address(0) || address(buy) != address(0), "zero address token");

        // uint256 sellAmountQ = sellAmount_.shiftl_toUint(int8(sell_.erc20Decimals()));

        // Only start an auction with well-defined prices
        //
        // In the BackingManager this may end up recalculating the RToken price
        (uint192 sellLow, uint192 sellHigh) = sell_.price(); // {UoA/sellTok}
        (uint192 buyLow, uint192 buyHigh) = buy_.price(); // {UoA/buyTok}
        require(sellLow > 0 && sellHigh < FIX_MAX, "bad sell pricing");
        require(buyLow > 0 && buyHigh < FIX_MAX, "bad buy pricing");

        // {UoA}
        uint192 maxTradeVolume = fixMin(sell_.maxTradeVolume(), buy_.maxTradeVolume());

        origin = ITrading(msg.sender);
        sell = sell_.erc20();
        buy = buy_.erc20();
        sellAmount = fixMin(sellAmount_, maxTradeVolume.div(sellHigh, FLOOR));
        startTime = uint48(block.timestamp);
        endTime = uint48(block.timestamp) + auctionLength;

        // {UoA} = {sellTok} * {UoA/sellTok}
        uint192 auctionVolume = sellAmount.mul(sellHigh, FLOOR);
        require(auctionVolume >= minTradeVolume_, "auction too small");

        // {1} = {1} * ({UoA} - {UoA}} / ({UoA} - {UoA})
        uint192 slippage = maxTradeSlippage_.mul(
            FIX_ONE - divuu(auctionVolume - minTradeVolume_, maxTradeVolume - minTradeVolume_)
        );

        // {buyTok/sellTok} = {1} * {UoA/sellTok} / {UoA/buyTok}
        lowPrice = sellLow.mulDiv(FIX_ONE - slippage, buyHigh, FLOOR);
        middlePrice = sellHigh.div(buyLow, CEIL); // no additional slippage
        // highPrice = 1.5 * middlePrice

        require(lowPrice <= middlePrice, "asset inverted pricing");
    }

    /// Calculates how much buy token is needed to purchase the lot, at a particular timestamp
    /// Price Curve:
    ///   - 1.5 * middlePrice down to the middlePrice for first 15% of auction
    ///   - middlePrice down to lowPrice for the last 80% of auction
    /// @param timestamp {s} The block timestamp to get price for
    /// @return {qBuyTok} The amount of buy tokens required to purchase the lot
    function bidAmount(uint48 timestamp) public view returns (uint256) {
        require(timestamp < endTime, "auction over");

        uint192 progression = divuu(uint48(block.timestamp) - startTime, endTime - startTime);
        // assert(progression <= FIX_ONE);

        // {buyTok/sellTok}
        uint192 price;

        if (progression < FIFTEEN_PERCENT) {
            // Fast decay -- 15th percentile case

            // highPrice is 1.5x middlePrice
            uint192 highPrice = middlePrice + middlePrice.mul(FIFTY_PERCENT);
            price = highPrice - (highPrice - middlePrice).mulDiv(progression, FIFTEEN_PERCENT);
        } else {
            // Slow decay -- 85th percentile case
            price =
                middlePrice -
                (middlePrice - lowPrice).mulDiv(progression - FIFTEEN_PERCENT, EIGHTY_FIVE_PERCENT);
        }

        // {qBuyTok} = {sellTok} * {buyTok/sellTok}
        return sellAmount.mul(price, CEIL).shiftl_toUint(int8(buy.decimals()), CEIL);
    }

    /// Bid for the auction lot at the current price; settling atomically via a callback
    /// @dev Caller must have provided approval
    function bid() external {
        require(bidder == address(0), "bid received");

        // {qBuyTok}
        uint256 buyAmount = bidAmount(uint48(block.timestamp));

        // Transfer in buy tokens
        bidder = msg.sender;
        buy.safeTransferFrom(bidder, address(this), buyAmount);
        // TODO examine reentrancy - should be okay

        // Settle via callback
        origin.settleTrade(sell);
    }

    /// Settle the auction, emptying the contract of balances
    /// @dev Buyer must have transferred buy tokens into the contract ahead of time
    function settle()
        external
        stateTransition(TradeStatus.OPEN, TradeStatus.CLOSED)
        returns (uint256 soldAmt, uint256 boughtAmt)
    {
        require(msg.sender == address(origin), "only origin can settle"); // via origin.settleTrade()

        // Received bid
        if (bidder != address(0)) {
            sell.safeTransfer(bidder, sellAmount);
        } else {
            require(block.timestamp >= endTime, "auction not over");
        }

        // {qBuyTok}
        uint256 boughtAmount = buy.balanceOf(address(this));

        // Transfer balances back to origin
        buy.safeTransfer(address(origin), boughtAmount);
        sell.safeTransfer(address(origin), sell.balanceOf(address(this)));
        return (sellAmount, boughtAmount);
    }

    /// Anyone can transfer any ERC20 back to the origin after the trade has been closed
    /// @dev Escape hatch in case of accidentally transferred tokens after auction end
    /// @custom:interaction CEI (and respects the state lock)
    function transferToOriginAfterTradeComplete(IERC20Metadata erc20) external {
        require(status == TradeStatus.CLOSED, "only after trade is closed");
        erc20.safeTransfer(address(origin), erc20.balanceOf(address(this)));
    }

    /// @return True if the trade can be settled.
    // Guaranteed to be true some time after init(), until settle() is called
    function canSettle() external view returns (bool) {
        return status == TradeStatus.OPEN && (bidder != address(0) || block.timestamp >= endTime);
    }
}
