// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "contracts/p0/Component.sol";
import "contracts/p0/interfaces/IMain.sol";
import "contracts/p0/interfaces/IMarket.sol";
import "contracts/p0/libraries/Rewards.sol";
import "contracts/libraries/Fixed.sol";

abstract contract TraderP0 is Component, ITraderEvents {
    using FixLib for Fix;
    using SafeERC20 for IERC20Metadata;

    // All auctions, OPEN and past.
    // Invariant: if 0 <= i and i+1 < auctions.length,
    //            then auctions[i].endTime <= auctions[i+1].endTime
    Auction[] public auctions;

    // First auction that is not yet closed (or auctions.length if all auctions have been closed)
    // invariant: auction[i].status == CLOSED iff i <= auctionsStart
    uint256 private auctionsStart;

    // The latest end time for any auction in `auctions`.
    uint256 private latestAuctionEnd;

    /// @return true iff this trader now has open auctions.
    function hasOpenAuctions() public view returns (bool) {
        return auctions.length > auctionsStart;
    }

    /// Settle any auctions that are due (past their end time)
    function closeDueAuctions() internal {
        // Close open auctions
        uint256 i = auctionsStart;
        for (; i < auctions.length && block.timestamp >= auctions[i].endTime; i++) {
            closeAuction(i);
        }
        auctionsStart = i;
    }

    /// Prepare an auction to sell `sellAmount` that guarantees a reasonable closing price,
    /// without explicitly aiming at a particular quantity to purchase.
    /// @param sellAmount {sellTok}
    /// @return notDust Whether the prepared auction is large enough to be worth trading
    /// @return auction The prepared auction
    function prepareAuctionSell(
        IAsset sell,
        IAsset buy,
        Fix sellAmount
    ) internal view returns (bool notDust, Auction memory auction) {
        assert(sell.price().neq(FIX_ZERO) && buy.price().neq(FIX_ZERO));

        // Don't buy dust.
        if (sellAmount.lt(dustThreshold(sell))) return (false, auction);

        // {sellTok}
        sellAmount = fixMin(sellAmount, sell.maxAuctionSize().div(sell.price()));

        // {buyTok} = {sellTok} * {UoA/sellTok} / {UoA/buyTok}
        Fix exactBuyAmount = sellAmount.mul(sell.price()).div(buy.price());
        Fix minBuyAmount = exactBuyAmount.mul(FIX_ONE.minus(main.settings().maxTradeSlippage()));

        // TODO Check floor() and ceil() rounding below
        return (
            true,
            Auction({
                sell: sell.erc20(),
                buy: buy.erc20(),
                sellAmount: sellAmount.shiftLeft(int8(sell.erc20().decimals())).floor(),
                minBuyAmount: minBuyAmount.shiftLeft(int8(buy.erc20().decimals())).ceil(),
                clearingSellAmount: 0,
                clearingBuyAmount: 0,
                externalAuctionId: 0,
                startTime: block.timestamp,
                endTime: Math.max(
                    block.timestamp + main.settings().auctionPeriod(),
                    latestAuctionEnd
                ),
                status: AuctionStatus.NOT_YET_OPEN
            })
        );
    }

    /// Assuming we have `maxSellAmount` sell tokens avaialable, prepare an auction to
    /// cover as much of our deficit as possible, given expected trade slippage.
    /// @param maxSellAmount {sellTok}
    /// @param deficitAmount {buyTok}
    /// @return notDust Whether the prepared auction is large enough to be worth trading
    /// @return auction The prepared auction
    function prepareAuctionToCoverDeficit(
        IAsset sell,
        IAsset buy,
        Fix maxSellAmount,
        Fix deficitAmount
    ) internal view returns (bool notDust, Auction memory auction) {
        // Don't sell dust.
        if (maxSellAmount.lt(dustThreshold(sell))) return (false, auction);

        // Don't buy dust.
        deficitAmount = fixMax(deficitAmount, dustThreshold(buy));

        // {sellTok} = {buyTok} * {UoA/buyTok} / {UoA/sellTok}
        Fix exactSellAmount = deficitAmount.mul(buy.price()).div(sell.price());
        // exactSellAmount: Amount to sell to buy `deficitAmount` if there's no slippage

        // idealSellAmount: Amount needed to sell to buy `deficitAmount`, counting slippage
        Fix idealSellAmount = exactSellAmount.div(
            FIX_ONE.minus(main.settings().maxTradeSlippage())
        );

        Fix sellAmount = fixMin(idealSellAmount, maxSellAmount);
        return prepareAuctionSell(sell, buy, sellAmount);
    }

    /// @return {tok} The least amount of whole tokens ever worth trying to sell
    function dustThreshold(IAsset asset) internal view returns (Fix) {
        // {tok} = {UoA} / {UoA/tok}
        return main.settings().dustAmount().div(asset.price());
    }

    /// Launch an auction:
    /// - Add the auction to the local auction list
    /// - Create the auction in the external auction protocol
    /// - Emit AuctionStarted event
    /// @dev The struct must already be populated
    function launchAuction(Auction memory auction_) internal {
        auctions.push(auction_);
        Auction storage auction = auctions[auctions.length - 1];

        auction.sell.safeApprove(address(main.market()), auction.sellAmount);

        auction.externalAuctionId = main.market().initiateAuction(
            auction.sell,
            auction.buy,
            auction.endTime,
            auction.endTime,
            uint96(auction.sellAmount),
            uint96(auction.minBuyAmount),
            0,
            0,
            false,
            address(0),
            new bytes(0)
        );
        auction.status = AuctionStatus.OPEN;
        latestAuctionEnd = auction.endTime;

        emit AuctionStarted(
            auctions.length - 1,
            auction.sell,
            auction.buy,
            auction.sellAmount,
            auction.minBuyAmount
        );
    }

    /// Close auctions[i]:
    /// - Set the auction status to DONE
    /// - Settle the auction in the external auction protocl
    /// - Emit AuctionEnded event
    function closeAuction(uint256 i) private {
        Auction storage auction = auctions[i];
        assert(auction.status == AuctionStatus.OPEN);
        assert(auction.endTime <= block.timestamp);

        bytes32 encodedOrder = main.market().settleAuction(auction.externalAuctionId);
        (auction.clearingSellAmount, auction.clearingBuyAmount) = decodeOrder(encodedOrder);

        auction.status = AuctionStatus.DONE;

        emit AuctionEnded(
            i,
            auction.sell,
            auction.buy,
            auction.clearingSellAmount,
            auction.clearingBuyAmount
        );
    }

    /// Decode EasyAuction output into its components.
    function decodeOrder(bytes32 encodedOrder)
        private
        pure
        returns (uint256 amountSold, uint256 amountBought)
    {
        // Note: explicitly converting to a uintN truncates those bits that don't fit
        uint256 value = uint256(encodedOrder);
        amountSold = uint96(value);
        amountBought = uint96(value >> 96);
    }
}
