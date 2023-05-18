// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../../libraries/Fixed.sol";
import "../../interfaces/IAsset.sol";
import "../../interfaces/ITrade.sol";

uint192 constant ONE_THIRD = FIX_ONE / 3; // {1} 1/3
uint192 constant TWO_THIRDS = ONE_THIRD * 2; // {1} 2/3

uint192 constant MAX_EXP = 31 * FIX_ONE; // {1} (5/4)^31 = 1009
// by using 4/5 as the base of the price exponential, the avg loss due to precision is exactly 10%
uint192 constant BASE = 8e17; // {1} (4/5)

/**
 * @title DutchTrade
 * @notice Implements a wholesale dutch auction via a piecewise falling-price mechansim.
 *   Over the first third of the auction the price falls from ~1000x the best plausible price
 *   down to the best expected price in a geometric series. The price decreases by 20% each time.
 *   This period DOES NOT expect to receive a bid; it defends against manipulated prices.
 *
 *   Over the last 2/3 of the auction the price falls from the best expected price to the worst
 *   price, linearly. The worst price is further discounted by the maxTradeSlippage as a fraction
 *   of how far from minTradeVolume to maxTradeVolume the trade lies.
 *   At maxTradeVolume, no further discount is applied.
 *
 * To bid:
 * - Call `bidAmount()` view to check prices at various timestamps
 * - Wait until desirable a block is reached
 * - Provide approval of buy tokens and call bid(). The swap will be atomic
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

    // The auction runs from [startTime, endTime], inclusive
    uint48 public startTime; // {s} when the dutch auction begins (1 block after init())
    uint48 public endTime; // {s} when the dutch auction ends if no bids are received

    // highPrice is always 8192x the middlePrice, so we don't need to track it explicitly
    uint192 public middlePrice; // {buyTok/sellTok} The price at which the function is piecewise
    uint192 public lowPrice; // {buyTok/sellTok} The price the auction ends at

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

    // === Public Bid Helper ===

    /// Calculates how much buy token is needed to purchase the lot, at a particular timestamp
    /// @param timestamp {s} The block timestamp to get price for
    /// @return {qBuyTok} The amount of buy tokens required to purchase the lot
    function bidAmount(uint48 timestamp) public view returns (uint256) {
        require(timestamp >= startTime, "auction not started");
        require(timestamp <= endTime, "auction over");

        // {buyTok/sellTok}
        uint192 price = _price(timestamp);

        // {qBuyTok} = {sellTok} * {buyTok/sellTok}
        return sellAmount.mul(price, CEIL).shiftl_toUint(int8(buy.decimals()), CEIL);
    }

    // === External ===

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
        (uint192 sellLow, uint192 sellHigh) = sell_.price(); // {UoA/sellTok}
        (uint192 buyLow, uint192 buyHigh) = buy_.price(); // {UoA/buyTok}
        require(sellLow > 0 && sellHigh < FIX_MAX, "bad sell pricing");
        require(buyLow > 0 && buyHigh < FIX_MAX, "bad buy pricing");

        origin = origin_;
        sell = sell_.erc20();
        buy = buy_.erc20();

        require(sellAmount_ <= sell.balanceOf(address(this)), "unfunded trade");
        sellAmount = shiftl_toFix(sellAmount_, -int8(sell.decimals())); // {sellTok}
        startTime = uint48(block.timestamp) + ONE_BLOCK; // start in the next block
        endTime = startTime + auctionLength;

        // {1}
        uint192 slippage = _slippage(
            sellAmount.mul(sellHigh, FLOOR), // auctionVolume
            origin.minTradeVolume(), // minTradeVolume
            fixMin(sell_.maxTradeVolume(), buy_.maxTradeVolume()) // maxTradeVolume
        );

        // {buyTok/sellTok} = {1} * {UoA/sellTok} / {UoA/buyTok}
        lowPrice = sellLow.mulDiv(FIX_ONE - slippage, buyHigh, FLOOR);
        middlePrice = sellHigh.div(buyLow, CEIL); // no additional slippage
        // highPrice = 1.5 * middlePrice

        assert(lowPrice <= middlePrice);
    }

    /// Bid for the auction lot at the current price; settling atomically via a callback
    /// @dev Caller must have provided approval
    /// @return amountIn {qBuyTok} The quantity of tokens the bidder paid
    function bid() external returns (uint256 amountIn) {
        require(bidder == address(0), "bid already received");

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
        require(msg.sender == address(origin), "only origin can settle");

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
        return status == TradeStatus.OPEN && (bidder != address(0) || block.timestamp > endTime);
    }

    // === Private ===

    /// Return a sliding % from 0 (at maxTradeVolume) to maxTradeSlippage (at minTradeVolume)
    /// @param auctionVolume {UoA} The actual auction volume
    /// @param minTradeVolume {UoA} The minimum trade volume
    /// @param maxTradeVolume {UoA} The maximum trade volume
    /// @return slippage {1} The fraction of auctionVolume that should be permitted as slippage
    function _slippage(
        uint192 auctionVolume,
        uint192 minTradeVolume,
        uint192 maxTradeVolume
    ) private view returns (uint192 slippage) {
        slippage = origin.maxTradeSlippage(); // {1}
        if (maxTradeVolume <= minTradeVolume || auctionVolume < minTradeVolume) return slippage;
        if (auctionVolume > maxTradeVolume) return 0; // 0% slippage beyond maxTradeVolume

        // {1} = {1} * ({UoA} - {UoA}} / ({UoA} - {UoA})
        return
            slippage.mul(
                FIX_ONE - divuu(auctionVolume - minTradeVolume, maxTradeVolume - minTradeVolume)
            );
    }

    /// Return the price of the auction based on a particular % progression
    /// @param timestamp {s} The block timestamp
    /// @return {buyTok/sellTok}
    function _price(uint48 timestamp) private view returns (uint192) {
        /// Price Curve:
        ///   - first 1/3%: exponentially 4/5ths the price from 1009x the middlePrice to 1x
        ///   - last 2/3: decrease linearly from middlePrice to lowPrice

        uint192 progression = divuu(timestamp - startTime, endTime - startTime); // {1}

        // Fast geometric decay -- 0%-33% of auction
        if (progression < ONE_THIRD) {
            uint192 exp = MAX_EXP.mulDiv(ONE_THIRD - progression, ONE_THIRD, ROUND);

            // middlePrice * ((5/4) ^ exp) = middlePrice / ((4/5) ^ exp)
            // safe uint48 downcast: exp is at-most 31
            // {buyTok/sellTok} = {buyTok/sellTok} / {1} ^ {1}
            return middlePrice.div(BASE.powu(uint48(exp.toUint(ROUND))), CEIL);
            // this reverts for middlePrice >= 6.21654046e36 * FIX_ONE
        }

        // Slow linear decay -- 33%-100% of auction
        return middlePrice - (middlePrice - lowPrice).mulDiv(progression - ONE_THIRD, TWO_THIRDS);
    }
}
