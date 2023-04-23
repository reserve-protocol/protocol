// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../interfaces/IAsset.sol";
import "../interfaces/ISwapper.sol";
import "../libraries/Fixed.sol";

struct DutchAuction {
    IAsset sell;
    IAsset buy;
    uint192 sellAmount; // {sellTok}
    uint192 middlePrice; // {buyTok/sellTok} The price at which the function is piecewise
    uint192 lowPrice; // {buyTok/sellTok} The price the auction ends at
    // note that the highPrice is always calculated as 1.5x the middlePrice
}

/**
 * @title DutchAuctionLib
 * @notice Implements a dutch auction via a piecewise falling-price mechansim.
 *   Over the first 15% of the auction the price falls from the ~150% pricepoint to the
 *   best price, as given by the price range. Over the last 85% of the auction it falls
 *   from the best price to the worst price. The worst price is additionally discounted by
 *   the maxTradeSlippage based on how far between minTradeVolume and maxTradeVolume the trade is.
 * @dev To use: Call makeAuction() to start the auction; then bid() any number of times
 */
library DutchAuctionLib {
    using FixLib for uint192;
    using SafeERC20 for IERC20;

    // Emitted when an atomic swap is performed
    /// @dev Duplicate of ISwapper event
    /// @param sell The ERC20 the protocol is selling
    /// @param buy The ERC20 the protocol is buying
    /// @param sellAmount {qSellTok} The quantity of the sell token
    /// @param buyAmount {qSellTok} The quantity of the buy token
    event SwapCompleted(
        IERC20 indexed sell,
        IERC20 indexed buy,
        uint256 sellAmount,
        uint256 buyAmount
    );

    /// Populates the largest possible auction in the provided memory struct
    /// @param auction Expected to be empty; will be overwritten
    /// @param sell The asset being sold by the protocol
    /// @param buy The asset being bought by the protocol
    /// @param sellAmount {sellTok} The amount to sell in the auction, in whole tokens
    /// @param minTradeVolume {UoA} The mimimum amount to trade
    /// @param maxTradeSlippage {1} An additional discount applied to the auction low price
    function makeAuction(
        IAsset sell,
        IAsset buy,
        uint192 sellAmount,
        uint192 minTradeVolume,
        uint192 maxTradeSlippage
    ) external view returns (DutchAuction memory auction) {
        require(address(sell) != address(0) || address(buy) != address(0), "zero address token");
        // 0 for the sellAmount should be handled correctly

        // Only start an auction with well-defined prices
        //
        // In the BackingManager this may end up recalculating the RToken price
        (uint192 sellLow, uint192 sellHigh) = sell.price(); // {UoA/sellTok}
        (uint192 buyLow, uint192 buyHigh) = buy.price(); // {UoA/buyTok}
        require(sellLow > 0 && sellHigh < FIX_MAX, "bad sell pricing");
        require(buyLow > 0 && buyHigh < FIX_MAX, "bad buy pricing");

        // {UoA}
        uint192 maxTradeVolume = fixMin(sell.maxTradeVolume(), buy.maxTradeVolume());

        auction.sell = sell;
        auction.buy = buy;
        auction.sellAmount = fixMin(sellAmount, maxTradeVolume.div(sellHigh, FLOOR));

        // {UoA} = {sellTok} * {UoA/sellTok}
        uint192 auctionVolume = auction.sellAmount.mul(sellHigh, FLOOR);
        require(auctionVolume >= minTradeVolume, "auction too small");

        // {1} = {1} * ({UoA} - {UoA}} / ({UoA} - {UoA})
        uint192 slippage = maxTradeSlippage.mul(
            FIX_ONE - divuu(auctionVolume - minTradeVolume, maxTradeVolume - minTradeVolume)
        );

        // {buyTok/sellTok} = {1} * {UoA/sellTok} / {UoA/buyTok}
        auction.lowPrice = sellLow.mulDiv(FIX_ONE - slippage, buyHigh, FLOOR);
        auction.middlePrice = sellHigh.div(buyLow, CEIL); // no additional slippage
        // auction.highPrice = 1.5 * auction.middlePrice

        require(auction.lowPrice <= auction.middlePrice, "asset inverted pricing");
    }

    // Provides a quote for a swap of the full auction amount at a progression
    /// @param progression {1} The fraction of the auction that has elapsed
    function toSwap(DutchAuction memory auction, uint192 progression)
        external
        view
        returns (Swap memory)
    {
        // {buyTok/sellTok}
        uint192 price = currentPrice(progression, auction.middlePrice, auction.lowPrice);

        // {buyTok} = {sellTok} * {buyTok/sellTok}
        uint192 buyAmount = auction.sellAmount.mul(price, CEIL);

        return
            Swap(
                auction.sell.erc20(),
                auction.buy.erc20(),
                auction.sellAmount.shiftl_toUint(int8(auction.sell.erc20Decimals()), FLOOR),
                buyAmount.shiftl_toUint(int8(auction.buy.erc20Decimals()), CEIL)
            );
    }

    /// Actually bids in the auction, changing the saved struct
    /// @param auction The stored auction
    /// @param progression {1} The fraction of the auction that has elapsed
    /// @param bidSellAmt {sellTok}
    function bid(
        DutchAuction storage auction,
        uint192 progression,
        uint192 bidSellAmt
    ) external returns (Swap memory swap) {
        assert(
            address(auction.sell) != address(0) &&
                address(auction.buy) != address(0) &&
                auction.middlePrice != 0 &&
                auction.lowPrice != 0
        ); // it's okay for sellAmount to be 0

        // {buyTok/sellTok}
        uint192 price = currentPrice(progression, auction.middlePrice, auction.lowPrice);

        // {buyTok} = {sellTok} * {buyTok/sellTok}
        uint192 bidBuyAmt = bidSellAmt.mul(price, CEIL);
        auction.sellAmount -= bidSellAmt;

        // Finalize bidder's swap
        swap = Swap(
            auction.sell.erc20(),
            auction.buy.erc20(),
            bidSellAmt.shiftl_toUint(int8(auction.sell.erc20Decimals()), FLOOR),
            bidBuyAmt.shiftl_toUint(int8(auction.buy.erc20Decimals()), CEIL)
        );

        require(swap.sellAmount > 0, "swap sellAmount 0");
        require(swap.buyAmount > 0, "swap buyAmount 0");
        emit SwapCompleted(swap.sell, swap.buy, swap.sellAmount, swap.buyAmount);

        // === Interactions ===

        // Transfer tokens in
        uint256 buyBal = swap.buy.balanceOf(address(this));
        swap.buy.safeTransferFrom(msg.sender, address(this), swap.buyAmount);
        assert(swap.buy.balanceOf(address(this)) - buyBal == swap.buyAmount);
        // TODO should we keep these asserts?

        // Transfer tokens out
        uint256 sellBal = swap.sell.balanceOf(address(this));
        swap.sell.safeTransfer(msg.sender, swap.sellAmount);
        assert(sellBal - swap.sell.balanceOf(address(this)) == swap.sellAmount);
    }

    // === Private ===

    uint192 private constant FIFTEEN_PERCENT = 15e16; // {1}
    uint192 private constant FIFTY_PERCENT = 50e16; // {1}
    uint192 private constant EIGHTY_FIVE_PERCENT = 85e16; // {1}

    /// Price Curve:
    ///   - 1.5 * middlePrice down to the middlePrice for first 20% of auction
    ///   - middlePrice down to lowPrice for the last 80% of auction
    /// @param progression {1} The fraction of the auction that has elapsed
    /// @param middlePrice {buyTok/sellTok} The price in the middle (kink) of the curve
    /// @param lowPrice {buyTok/sellTok} The price at the bottom (end) of the curve
    /// @return {buyTok/sellTok} The price in the current block
    function currentPrice(
        uint192 progression,
        uint192 middlePrice,
        uint192 lowPrice
    ) private pure returns (uint192) {
        assert(progression <= FIX_ONE);
        assert(lowPrice <= middlePrice);

        if (progression < FIFTEEN_PERCENT) {
            // Fast decay -- 15th percentile case

            // highPrice is 1.5x middlePrice
            uint192 highPrice = middlePrice + middlePrice.mul(FIFTY_PERCENT);
            return highPrice - (highPrice - middlePrice).mulDiv(progression, FIFTEEN_PERCENT);
        } else {
            // Slow decay -- 85th percentile case
            return
                middlePrice -
                (middlePrice - lowPrice).mulDiv(progression - FIFTEEN_PERCENT, EIGHTY_FIVE_PERCENT);
        }
    }
}
