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
 *   Over the first 20% of the auction the price falls from the ~150% pricepoint to the
 *   best price, as given by the price range. Over the last 80% of the auction it falls
 *   from the best price to the worst price.
 * @dev To use: Call setupAuction() once to start the auction; then bid() any number of times
 */
library DutchAuctionLib {
    using FixLib for uint192;
    using SafeERC20 for IERC20;

    /// Starts an auction in the provided storage struct
    /// @param auction Expected to be empty; will be overwritten
    /// @param sell The asset being sold by the protocol
    /// @param buy The asset being bought by the protocol
    /// @param sellAmount {sellTok} The amount to sell in the auction, in whole tokens
    function setupAuction(
        DutchAuction storage auction,
        IAsset sell,
        IAsset buy,
        uint192 sellAmount
    ) external {
        require(address(sell) != address(0) || address(buy) != address(0), "auction already setup");
        // 0 for the sellAmount should be handled correctly

        auction.sell = sell;
        auction.buy = buy;
        auction.sellAmount = sellAmount;

        // Only start an auction with well-defined prices
        (uint192 sellLow, uint192 sellHigh) = auction.sell.price(); // {UoA/sellTok}
        (uint192 buyLow, uint192 buyHigh) = auction.buy.price(); // {UoA/buyTok}
        require(sellLow > 0 && sellHigh < FIX_MAX, "bad sell pricing");
        require(buyLow > 0 && buyHigh < FIX_MAX, "bad buy pricing");

        uint192 middlePrice = sellHigh.div(buyLow, CEIL); // the 1.5x price is the highPrice
        uint192 lowPrice = sellLow.div(buyHigh, FLOOR);
        require(lowPrice <= middlePrice, "asset inverted pricing");
        auction.middlePrice = middlePrice;
        auction.lowPrice = lowPrice;
    }

    /// Actually bids in the auction, changing the saved struct
    /// @param auction The stored auction
    /// @param progression {1} The fraction of the auction that has elapsed
    /// @param bidBuyAmt {buyTok}
    function bid(
        DutchAuction storage auction,
        uint192 progression,
        uint192 bidBuyAmt
    ) external returns (Swap memory swap) {
        assert(
            address(auction.sell) != address(0) &&
                address(auction.buy) != address(0) &&
                auction.middlePrice != 0 &&
                auction.lowPrice != 0
        ); // it's okay for sellAmount to be 0

        // {buyTok/sellTok}
        uint192 price = currentPrice(progression, auction.middlePrice, auction.lowPrice);

        // {sellTok} = {buyTok} / {buyTok/sellTok}
        uint192 bidSellAmt = bidBuyAmt.div(price, FLOOR);
        auction.sellAmount -= bidSellAmt;

        // Finalize bidder's swap
        swap = Swap(
            auction.sell.erc20(),
            auction.buy.erc20(),
            bidSellAmt.shiftl_toUint(int8(auction.sell.erc20Decimals()), FLOOR),
            bidBuyAmt.shiftl_toUint(int8(auction.buy.erc20Decimals()), CEIL)
        );

        // Transfer tokens in
        uint256 buyBal = swap.buy.balanceOf(address(this));
        swap.buy.safeTransferFrom(msg.sender, address(this), swap.buyAmount);
        assert(swap.buy.balanceOf(address(this)) - buyBal == swap.buyAmount);

        // Transfer tokens out
        uint256 sellBal = swap.sell.balanceOf(address(this));
        swap.sell.safeTransfer(msg.sender, swap.sellAmount);
        assert(sellBal - swap.sell.balanceOf(address(this)) == swap.sellAmount);
    }

    // ===

    uint192 private constant TWENTY_PERCENT = 2e17; // {1}
    uint192 private constant FIFTY_PERCENT = 5e17; // {1}
    uint192 private constant EIGHTY_PERCENT = 8e17; // {1}

    /// Price Curve:
    ///   - 1.5 * middlePrice down to the middlePrice for first 20% of auction
    ///   - middlePrice down to lowPrice for the last 80% of auction
    /// @param progression {1} The fraction of the auction that has elapsed
    /// @param middlePrice {buyTok/sellTok} Should be > lowPrice
    /// @param lowPrice {buyTok/sellTok}
    /// @return {buyTok/sellTok} The price in the current block
    function currentPrice(
        uint192 progression,
        uint192 middlePrice,
        uint192 lowPrice
    ) public pure returns (uint192) {
        assert(progression <= FIX_ONE);
        assert(middlePrice >= lowPrice);

        // Override prices in the 20 percentile case
        if (progression < TWENTY_PERCENT) {
            // using the avgPrice here is tempting but a bad idea, because it would require
            // making an assumption about the tightness of the price band.

            // Fast decay
            uint192 highPrice = middlePrice + middlePrice.mul(FIFTY_PERCENT);
            progression = progression.div(TWENTY_PERCENT);
            return highPrice - (highPrice - middlePrice).mul(FIX_ONE - progression);
        } else {
            // Slow decay -- 80 percentile case
            progression = (progression - TWENTY_PERCENT).div(EIGHTY_PERCENT);
            return middlePrice - (middlePrice - lowPrice).mul(FIX_ONE - progression);
        }
    }
}
