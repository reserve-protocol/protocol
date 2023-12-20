// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../../libraries/Fixed.sol";
import "../../libraries/NetworkConfigLib.sol";
import "../../interfaces/IAsset.sol";
import "../../interfaces/IBroker.sol";
import "../../interfaces/ITrade.sol";

interface IDutchTradeCallee {
    function dutchTradeCallback(
        address caller,
        address buyToken,
        uint256 buyAmount,
        bytes calldata data
    ) external;
}

// A dutch auction in 4 parts:
//   1.  0% -  20%: Geometric decay from 1000x the bestPrice to ~1.5x the bestPrice
//   2. 20% -  45%: Linear decay from ~1.5x the bestPrice to the bestPrice
//   3. 45% -  95%: Linear decay from the bestPrice to the worstPrice
//   4. 95% - 100%: Constant at the worstPrice
//
// For a trade between 2 assets with 1% oracleError:
//   A 30-minute auction on a chain with a 12-second blocktime has a ~20% price drop per block
//   during the 1st period, ~0.8% during the 2nd period, and ~0.065% during the 3rd period.
//
//   30-minutes is the recommended length of auction for a chain with 12-second blocktimes.
//   6 minutes, 7.5 minutes, 15 minutes, 1.5 minutes for each pariod respectively.
//
//   Longer and shorter times can be used as well. The pricing method does not degrade
//   beyond the degree to which less overall blocktime means less overall precision.

uint192 constant FIVE_PERCENT = 5e16; // {1} 0.05
uint192 constant TWENTY_PERCENT = 20e16; // {1} 0.2
uint192 constant TWENTY_FIVE_PERCENT = 25e16; // {1} 0.25
uint192 constant FORTY_FIVE_PERCENT = 45e16; // {1} 0.45
uint192 constant FIFTY_PERCENT = 50e16; // {1} 0.5
uint192 constant NINETY_FIVE_PERCENT = 95e16; // {1} 0.95

uint192 constant MAX_EXP = 6502287e18; // {1} (1000000/999999)^6502287 = ~666.6667
uint192 constant BASE = 999999e12; // {1} (999999/1000000)
uint192 constant ONE_POINT_FIVE = 150e16; // {1} 1.5

/**
 * @title DutchTrade
 * @notice Implements a wholesale dutch auction via a 4-piecewise falling-price mechansim.
 *   The overall idea is to handle 4 cases:
 *     1. Price manipulation of the exchange rate up to 1000x (eg: via a read-only reentrancy)
 *     2. Price movement of up to 50% during the auction
 *     3. Typical case: no significant price movement; clearing price within expected range
 *     4. No bots online; manual human doing bidding; additional time for tx clearing
 *
 *   Case 1: Over the first 20% of the auction the price falls from ~1000x the best plausible
 *   price down to 1.5x the best plausible price in a geometric series.
 *   This period DOES NOT expect to receive a bid; it just defends against manipulated prices.
 *   If a bid occurs during this period, a violation is reported to the Broker.
 *   This is still safe for the protocol since other trades, with price discovery, can occur.
 *
 *   Case 2: Over the next 20% of the auction the price falls from 1.5x the best plausible price
 *   to the best plausible price, linearly. No violation is reported if a bid occurs. This case
 *   exists to handle cases where prices change after the auction is started, naturally.
 *
 *   Case 3: Over the next 50% of the auction the price falls from the best plausible price to the
 *   worst price, linearly. The worst price is further discounted by the maxTradeSlippage.
 *   This is the phase of the auction where bids will typically occur.
 *
 *   Case 4: Lastly the price stays at the worst price for the final 5% of the auction to allow
 *   a bid to occur if no bots are online and the only bidders are humans.
 *
 * To bid:
 * 1. Call `bidAmount()` view to check prices at various blocks.
 * 2. Provide approval of sell tokens for precisely the `bidAmount()` desired
 * 3. Wait until the desired block is reached (hopefully not in the first 20% of the auction)
 * 4. Call bid()
 */
contract DutchTrade is ITrade {
    using FixLib for uint192;
    using SafeERC20 for IERC20Metadata;

    TradeKind public constant KIND = TradeKind.DUTCH_AUCTION;

    // solhint-disable-next-line var-name-mixedcase
    uint48 public immutable ONE_BLOCK; // {s} 1 block based on network

    TradeStatus public status; // reentrancy protection

    IBroker public broker; // The Broker that cloned this contract into existence
    ITrading public origin; // the address that initialized the contract

    // === Auction ===
    IERC20Metadata public sell;
    IERC20Metadata public buy;
    uint192 public sellAmount; // {sellTok}

    // The auction runs from [startBlock, endTime], inclusive
    uint256 public startBlock; // {block} when the dutch auction begins (one block after init())
    uint256 public endBlock; // {block} when the dutch auction ends if no bids are received
    uint48 public endTime; // {s} not used in this contract; needed on interface

    uint192 public bestPrice; // {buyTok/sellTok} The best plausible price based on oracle data
    uint192 public worstPrice; // {buyTok/sellTok} The worst plausible price based on oracle data

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

    // === Auction Sizing Views ===

    /// @return {qSellTok} The size of the lot being sold, in token quanta
    function lot() public view returns (uint256) {
        return sellAmount.shiftl_toUint(int8(sell.decimals()));
    }

    /// Calculates how much buy token is needed to purchase the lot at a particular block
    /// @param blockNumber {block} The block number of the bid
    /// @return {qBuyTok} The amount of buy tokens required to purchase the lot
    function bidAmount(uint256 blockNumber) external view returns (uint256) {
        return _bidAmount(_price(blockNumber));
    }

    // ==== Constructor ===

    constructor() {
        ONE_BLOCK = NetworkConfigLib.blocktime();

        status = TradeStatus.CLOSED;
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
                auctionLength >= 20 * ONE_BLOCK
        ); // misuse by caller

        // Only start dutch auctions under well-defined prices
        require(prices.sellLow != 0 && prices.sellHigh < FIX_MAX / 1000, "bad sell pricing");
        require(prices.buyLow != 0 && prices.buyHigh < FIX_MAX / 1000, "bad buy pricing");

        broker = IBroker(msg.sender);
        origin = origin_;
        sell = sell_.erc20();
        buy = buy_.erc20();

        require(sellAmount_ <= sell.balanceOf(address(this)), "unfunded trade");
        sellAmount = shiftl_toFix(sellAmount_, -int8(sell.decimals())); // {sellTok}

        uint256 _startBlock = block.number + 1; // start in the next block
        startBlock = _startBlock; // gas-saver

        uint256 _endBlock = _startBlock + auctionLength / ONE_BLOCK; // FLOOR; endBlock is inclusive
        endBlock = _endBlock; // gas-saver

        endTime = uint48(block.timestamp + ONE_BLOCK * (_endBlock - _startBlock + 1));

        // {buyTok/sellTok} = {UoA/sellTok} * {1} / {UoA/buyTok}
        uint192 _worstPrice = prices.sellLow.mulDiv(
            FIX_ONE - origin.maxTradeSlippage(),
            prices.buyHigh,
            FLOOR
        );
        uint192 _bestPrice = prices.sellHigh.div(prices.buyLow, CEIL); // no additional slippage
        assert(_worstPrice <= _bestPrice);
        worstPrice = _worstPrice; // gas-saver
        bestPrice = _bestPrice; // gas-saver
    }

    /// Bid with callback for the auction lot at the current price;
    ///  Sold funds are sent back to the callee, callee.dutchTradeCallback(...) is invoked
    ///  balance of buy token must increase by bidAmount(current block) after callback
    ///  Trade is settled atomically via a callback
    ///
    /// @param data {bytes} The data to pass to the callback
    /// @dev Caller must implement IDutchTradeCallee
    /// @return amountIn {qBuyTok} The quantity of tokens the bidder paid
    function bid(bytes calldata data) external returns (uint256 amountIn) {
        require(bidder == address(0), "bid already received");
        // {buyTok/sellTok}
        uint192 price = _price(block.number); // enforces auction ongoing

        // {qBuyTok}
        amountIn = _bidAmount(price);

        // Transfer in buy tokens
        bidder = msg.sender;

        // status must begin OPEN
        assert(status == TradeStatus.OPEN);

        // reportViolation if auction cleared in geometric phase
        if (price > bestPrice.mul(ONE_POINT_FIVE, CEIL)) {
            broker.reportViolation();
        }
        sell.safeTransfer(bidder, lot()); // {qSellTok}
        uint256 balanceBefore = buy.balanceOf(address(this));
        IDutchTradeCallee(bidder).dutchTradeCallback(bidder, address(buy), amountIn, data);
        require(
            amountIn <= buy.balanceOf(address(this)) - balanceBefore,
            "insufficient buy tokens"
        );

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
            // {qSellTok}
            soldAmt = lot();
        } else {
            require(block.number > endBlock, "auction not over");
        }

        // Transfer remaining balances back to origin
        boughtAmt = buy.balanceOf(address(this)); // {qBuyTok}
        buy.safeTransfer(address(origin), boughtAmt); // {qBuyTok}
        sell.safeTransfer(address(origin), sell.balanceOf(address(this))); // {qSellTok}
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
        return status == TradeStatus.OPEN && (bidder != address(0) || block.number > endBlock);
    }

    // === Private ===

    /// Return the price of the auction at a particular timestamp
    /// @param blockNumber {block} The block number to get price for
    /// @return {buyTok/sellTok}
    function _price(uint256 blockNumber) private view returns (uint192) {
        uint256 _startBlock = startBlock; // gas savings
        uint256 _endBlock = endBlock; // gas savings
        require(blockNumber >= _startBlock, "auction not started");
        require(blockNumber <= _endBlock, "auction over");

        /// Price Curve:
        ///   - first 20%: geometrically decrease the price from 1000x the bestPrice to 1.5x it
        ///   - next  25%: linearly decrease the price from 1.5x the bestPrice to 1x it
        ///   - next  50%: linearly decrease the price from bestPrice to worstPrice
        ///   - last   5%: constant at worstPrice

        uint192 progression = divuu(blockNumber - _startBlock, _endBlock - _startBlock); // {1}

        // Fast geometric decay -- 0%-20% of auction
        if (progression < TWENTY_PERCENT) {
            uint192 exp = MAX_EXP.mulDiv(TWENTY_PERCENT - progression, TWENTY_PERCENT, ROUND);

            // bestPrice * ((1000000/999999) ^ exp) = bestPrice / ((999999/1000000) ^ exp)
            // safe uint48 downcast: exp is at-most 6502287
            // {buyTok/sellTok} = {buyTok/sellTok} / {1} ^ {1}
            return bestPrice.mulDiv(ONE_POINT_FIVE, BASE.powu(uint48(exp.toUint(ROUND))), CEIL);
            // this reverts for bestPrice >= 6.21654046e36 * FIX_ONE
        } else if (progression < FORTY_FIVE_PERCENT) {
            // First linear decay -- 20%-45% of auction
            // 1.5x -> 1x the bestPrice

            uint192 _bestPrice = bestPrice; // gas savings
            // {buyTok/sellTok} = {buyTok/sellTok} * {1}
            uint192 highPrice = _bestPrice.mul(ONE_POINT_FIVE, CEIL);
            return
                highPrice -
                (highPrice - _bestPrice).mulDiv(progression - TWENTY_PERCENT, TWENTY_FIVE_PERCENT);
        } else if (progression < NINETY_FIVE_PERCENT) {
            // Second linear decay -- 45%-95% of auction
            // bestPrice -> worstPrice

            uint192 _bestPrice = bestPrice; // gas savings
            // {buyTok/sellTok} = {buyTok/sellTok} * {1}
            return
                _bestPrice -
                (_bestPrice - worstPrice).mulDiv(progression - FORTY_FIVE_PERCENT, FIFTY_PERCENT);
        }

        // Constant price -- 95%-100% of auction
        return worstPrice;
    }

    /// Calculates how much buy token is needed to purchase the lot at a particular price
    /// @param price {buyTok/sellTok}
    /// @return {qBuyTok} The amount of buy tokens required to purchase the lot
    function _bidAmount(uint192 price) public view returns (uint256) {
        // {qBuyTok} = {sellTok} * {buyTok/sellTok} * {qBuyTok/buyTok}
        return sellAmount.mul(price, CEIL).shiftl_toUint(int8(buy.decimals()), CEIL);
    }
}
