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
 * To bid:
 * - Call `bidAmount()` to check price at various timestamps
 * - Wait until desirable block is reached
 * - Provide approval of buy tokens and call bid(). Swap will be atomic
 */
contract DutchTrade is ITrade {
    using FixLib for uint192;
    using SafeERC20 for IERC20Metadata;

    TradeKind public constant KIND = TradeKind.DUTCH_AUCTION;

    TradeStatus public status; // reentrancy protection

    ITrading public origin; // initializer

    // === Auction ===
    IERC20Metadata public sell;
    IERC20Metadata public buy;
    uint192 public sellAmount; // {sellTok}

    // The auction runs from [startTime, endTime)
    uint48 public startTime; // {s} when the dutch auction begins (1 block after init())
    uint48 public endTime; // {s} when the dutch auction ends if no bids are received

    uint192 public middlePrice; // {buyTok/sellTok} The price at which the function is piecewise
    uint192 public lowPrice; // {buyTok/sellTok} The price the auction ends at
    // highPrice is always 1.5x the middlePrice, so we don't need to track it explicitly

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

    /// @param origin_ The Trader that originated the trade
    /// @param sell_ The asset being sold by the protocol
    /// @param buy_ The asset being bought by the protocol
    /// @param sellAmount_ {qSellTok} The amount to sell in the auction, in token quanta
    /// @param auctionLength {s} How many seconds the dutch auction should run for
    function init(
        ITrading origin_,
        IAsset sell_,
        IAsset buy_,
        uint256 sellAmount_,
        uint48 auctionLength
    ) external stateTransition(TradeStatus.NOT_STARTED, TradeStatus.OPEN) {
        assert(
            address(sell_) != address(0) &&
                address(buy_) != address(0) &&
                auctionLength >= 2 * ONE_BLOCK
        ); // misuse by caller

        // Only start dutch auctions under well-defined prices
        //
        // may end up recalculating the RToken price
        (uint192 sellLow, uint192 sellHigh) = sell_.price(); // {UoA/sellTok}
        (uint192 buyLow, uint192 buyHigh) = buy_.price(); // {UoA/buyTok}
        require(sellLow > 0 && sellHigh < FIX_MAX, "bad sell pricing");
        require(buyLow > 0 && buyHigh < FIX_MAX, "bad buy pricing");

        origin = origin_;
        sell = sell_.erc20();
        buy = buy_.erc20();

        require(sellAmount_ <= sell.balanceOf(address(this)), "unfunded trade");
        sellAmount = shiftl_toFix(sellAmount_, -int8(sell.decimals())); // {sellTok}
        startTime = uint48(block.timestamp) + ONE_BLOCK;
        endTime = startTime + auctionLength;

        // {UoA}
        uint192 maxTradeVolume = fixMin(sell_.maxTradeVolume(), buy_.maxTradeVolume());
        uint192 minTradeVolume = origin.minTradeVolume();

        // Apply sliding slippage from 0% at maxTradeVolume to maxTradeSlippage() at minTradeVolume
        uint192 slippage = origin.maxTradeSlippage(); // {1}
        if (minTradeVolume < maxTradeVolume) {
            // {UoA} = {sellTok} * {UoA/sellTok}
            uint192 auctionVolume = sellAmount.mul(sellHigh, FLOOR);

            if (auctionVolume > minTradeVolume && auctionVolume <= maxTradeVolume) {
                // {1} = {1} * ({UoA} - {UoA}} / ({UoA} - {UoA})
                slippage = slippage.mul(
                    FIX_ONE - divuu(auctionVolume - minTradeVolume, maxTradeVolume - minTradeVolume)
                );
            } else if (auctionVolume > maxTradeVolume) {
                slippage = 0;
            }
        }
        // {buyTok/sellTok} = {1} * {UoA/sellTok} / {UoA/buyTok}
        lowPrice = sellLow.mulDiv(FIX_ONE - slippage, buyHigh, FLOOR);
        middlePrice = sellHigh.div(buyLow, CEIL); // no additional slippage
        // highPrice = 1.5 * middlePrice

        require(lowPrice <= middlePrice, "asset inverted pricing");
    }

    /// Bid for the auction lot at the current price; settling atomically via a callback
    /// @dev Caller must have provided approval
    /// @return amountIn {qBuyTok} The quantity of tokens the bidder paid
    function bid() external returns (uint256 amountIn) {
        require(bidder == address(0), "bid received");

        // {qBuyTok}
        amountIn = bidAmount(uint48(block.timestamp)); // enforces auction ongoing

        // Transfer in buy tokens
        bidder = msg.sender;
        buy.safeTransferFrom(bidder, address(this), amountIn);

        // status must begin OPEN
        assert(status == TradeStatus.OPEN);

        // settle() via callback
        origin.settleTrade(sell);

        // confirm callback succeeded
        assert(status == TradeStatus.CLOSED);
    }

    /// Settle the auction, emptying the contract of balances
    /// @return soldAmt {qSellTok} Token quantity sold by the protocol
    /// @return boughtAmt {qBuyTok} Token quantity purchased by the protocol
    function settle()
        external
        stateTransition(TradeStatus.OPEN, TradeStatus.CLOSED)
        returns (uint256 soldAmt, uint256 boughtAmt)
    {
        require(msg.sender == address(origin), "only origin can settle"); // origin.settleTrade()

        // Received bid
        if (bidder != address(0)) {
            sell.safeTransfer(bidder, sellAmount);
        } else {
            require(block.timestamp >= endTime, "auction not over");
        }

        uint256 sellBal = sell.balanceOf(address(this));
        soldAmt = sellAmount > sellBal ? sellAmount - sellBal : 0;
        boughtAmt = buy.balanceOf(address(this));

        // Transfer balances back to origin
        buy.safeTransfer(address(origin), boughtAmt);
        sell.safeTransfer(address(origin), sellBal);
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

    // === Bid Helper ===

    /// Calculates how much buy token is needed to purchase the lot, at a particular timestamp
    /// Price Curve:
    ///   - 1.5 * middlePrice down to the middlePrice for first 15% of auction
    ///   - middlePrice down to lowPrice for the last 85% of auction
    /// @param timestamp {s} The block timestamp to get price for
    /// @return {qBuyTok} The amount of buy tokens required to purchase the lot
    function bidAmount(uint48 timestamp) public view returns (uint256) {
        require(timestamp >= startTime, "cannot bid block auction was created");
        require(timestamp < endTime, "auction over");

        uint192 progression = divuu(timestamp - startTime, endTime - startTime);
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
}
