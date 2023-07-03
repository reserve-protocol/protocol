// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../../libraries/Fixed.sol";
import "../../libraries/NetworkConfigLib.sol";
import "../../interfaces/IAsset.sol";
import "../../interfaces/IBroker.sol";
import "../../interfaces/ITrade.sol";
import "../../mixins/NetworkConfigLib.sol";

uint192 constant FORTY_PERCENT = 4e17; // {1} 0.4
uint192 constant SIXTY_PERCENT = 6e17; // {1} 0.6

// Exponential price decay with base (999999/1000000). Price starts at 1000x and decays to <1x
//   A 30-minute auction on a chain with a 12-second blocktime has a ~10.87% price drop per block
//   during the geometric/exponential period and a 0.05% drop per block during the linear period.
//   30-minutes is the recommended length of auction for a chain with 12-second blocktimes, but
//   longer and shorter times can be used as well. The pricing method does not degrade
//   beyond the degree to which less overall blocktime means necessarily larger price drops.
uint192 constant MAX_EXP = 6907752 * FIX_ONE; // {1} (1000000/999999)^6907752 = ~1000x
uint192 constant BASE = 999999e12; // {1} (999999/1000000)

/**
 * @title DutchTrade
 * @notice Implements a wholesale dutch auction via a piecewise falling-price mechansim.
 *   Over the first 40% of the auction the price falls from ~1000x the best plausible price
 *   down to the best plausible price in a geometric series. The price decreases by the same %
 *   each time. At 30 minutes the decreases are 10.87% per block. Longer auctions have
 *   smaller price decreases, and shorter auctions have larger price decreases.
 *   This period DOES NOT expect to receive a bid; it just defends against manipulated prices.
 *
 *   Over the last 60% of the auction the price falls from the best plausible price to the worst
 *   price, linearly. The worst price is further discounted by the maxTradeSlippage as a fraction
 *   of how far from minTradeVolume to maxTradeVolume the trade lies.
 *   At maxTradeVolume, no additonal discount beyond the oracle errors is applied.
 *
 * To bid:
 * 1. Call `bidAmount()` view to check prices at various timestamps
 * 2. Provide approval of sell tokens for precisely the `bidAmount()` desired
 * 3. Wait until a desirable block is reached (hopefully not in the first 40% of the auction)
 * 4. Call bid()
 */
contract DutchTrade is ITrade {
    using FixLib for uint192;
    using SafeERC20 for IERC20Metadata;

    TradeKind public constant KIND = TradeKind.DUTCH_AUCTION;

    // solhint-disable-next-line var-name-mixedcase
    uint48 public immutable ONE_BLOCK; // {s} 1 block based on network

    TradeStatus public status; // reentrancy protection

    ITrading public origin; // the address that initialized the contract

    // === Auction ===
    IERC20Metadata public sell;
    IERC20Metadata public buy;
    uint192 public sellAmount; // {sellTok}

    // The auction runs from [startTime, endTime], inclusive
    uint48 public startTime; // {s} when the dutch auction begins (one block after init())
    uint48 public endTime; // {s} when the dutch auction ends if no bids are received

    // highPrice is always 1000x the middlePrice, so we don't need to track it explicitly
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

        // {qBuyTok} = {sellTok} * {buyTok/sellTok} * {qBuyTok/buyTok}
        return sellAmount.mul(price, CEIL).shiftl_toUint(int8(buy.decimals()), CEIL);
    }

    constructor() {
        ONE_BLOCK = NetworkConfigLib.blocktime();
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
        uint48 auctionLength,
        TradePrices memory prices
    ) external stateTransition(TradeStatus.NOT_STARTED, TradeStatus.OPEN) {
        assert(
            address(sell_) != address(0) &&
                address(buy_) != address(0) &&
                auctionLength >= 2 * ONE_BLOCK
        ); // misuse by caller

        // Only start dutch auctions under well-defined prices
        require(prices.sellLow > 0 && prices.sellHigh < FIX_MAX, "bad sell pricing");
        require(prices.buyLow > 0 && prices.buyHigh < FIX_MAX, "bad buy pricing");

        origin = origin_;
        sell = sell_.erc20();
        buy = buy_.erc20();

        require(sellAmount_ <= sell.balanceOf(address(this)), "unfunded trade");
        sellAmount = shiftl_toFix(sellAmount_, -int8(sell.decimals())); // {sellTok}
        startTime = uint48(block.timestamp) + ONE_BLOCK; // start in the next block
        endTime = startTime + auctionLength;

        // {1}
        uint192 slippage = _slippage(
            sellAmount.mul(prices.sellHigh, FLOOR), // auctionVolume
            origin.minTradeVolume(), // minTradeVolume
            fixMin(sell_.maxTradeVolume(), buy_.maxTradeVolume()) // maxTradeVolume
        );

        // {buyTok/sellTok} = {UoA/sellTok} * {1} / {UoA/buyTok}
        lowPrice = prices.sellLow.mulDiv(FIX_ONE - slippage, prices.buyHigh, FLOOR);
        middlePrice = prices.sellHigh.div(prices.buyLow, CEIL); // no additional slippage
        // highPrice = 1000 * middlePrice

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

    /// @return true iff the trade can be settled.
    // Guaranteed to be true some time after init(), until settle() is called
    function canSettle() external view returns (bool) {
        return status == TradeStatus.OPEN && (bidder != address(0) || block.timestamp > endTime);
    }

    /// @return {qSellTok} The size of the lot being sold, in token quanta
    function lot() external view returns (uint256) {
        return sellAmount.shiftl_toUint(int8(sell.decimals()));
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

        // untestable:
        //     auctionVolume already sized based on maxTradeVolume, so this will not be true
        if (auctionVolume > maxTradeVolume) return 0; // 0% slippage beyond maxTradeVolume

        // {1} = {1} * ({UoA} - {UoA}} / ({UoA} - {UoA})
        return
            slippage.mul(
                FIX_ONE - divuu(auctionVolume - minTradeVolume, maxTradeVolume - minTradeVolume)
            );
    }

    /// Return the price of the auction at a particular timestamp
    /// @param timestamp {s} The block timestamp
    /// @return {buyTok/sellTok}
    function _price(uint48 timestamp) private view returns (uint192) {
        /// Price Curve:
        ///   - first 40%: geometrically decrease the price from 1000x the middlePrice to 1x
        ///   - last 60: decrease linearly from middlePrice to lowPrice

        uint192 progression = divuu(timestamp - startTime, endTime - startTime); // {1}

        // Fast geometric decay -- 0%-40% of auction
        if (progression < FORTY_PERCENT) {
            uint192 exp = MAX_EXP.mulDiv(FORTY_PERCENT - progression, FORTY_PERCENT, ROUND);

            // middlePrice * ((1000000/999999) ^ exp) = middlePrice / ((999999/1000000) ^ exp)
            // safe uint48 downcast: exp is at-most 6907752
            // {buyTok/sellTok} = {buyTok/sellTok} / {1} ^ {1}
            return middlePrice.div(BASE.powu(uint48(exp.toUint(ROUND))), CEIL);
            // this reverts for middlePrice >= 6.21654046e36 * FIX_ONE
        }

        // Slow linear decay -- 40%-100% of auction
        return
            middlePrice -
            (middlePrice - lowPrice).mulDiv(progression - FORTY_PERCENT, SIXTY_PERCENT);
    }
}
