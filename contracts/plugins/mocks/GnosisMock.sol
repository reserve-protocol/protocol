// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/plugins/trading/GnosisTrade.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/libraries/Fixed.sol";

interface IBiddable {
    /// @param auctionId An internal auction id, not the one from AssetManager
    /// @param bid A Bid
    function placeBid(uint256 auctionId, Bid memory bid) external;
}

enum MauctionStatus {
    NOT_YET_OPEN,
    OPEN,
    DONE
}

/*
 *  Mauction = MockAuction
 */
struct Mauction {
    address origin;
    IERC20 sell;
    IERC20 buy;
    uint256 sellAmount; // {qSellTok}
    uint256 minBuyAmount; // {qBuyTok}
    uint256 startTime; // {sec}
    uint256 endTime; // {sec}
    MauctionStatus status;
    bytes32 encodedClearingOrder;
}

struct Bid {
    address bidder;
    uint256 sellAmount; // Mauction.sell
    uint256 buyAmount; // Mauction.buy
}

/// A very simple trading partner that only supports 1 bid per auction
contract GnosisMock is IGnosis, IBiddable {
    using FixLib for Fix;
    using SafeERC20 for IERC20;

    Mauction[] public auctions;
    mapping(uint256 => Bid) public bids; // auctionId -> Bid

    /// @return auctionId The internal auction id
    function initiateAuction(
        IERC20 auctioningToken,
        IERC20 biddingToken,
        uint256,
        uint256 auctionEndDate,
        uint96 auctionedSellAmount,
        uint96 minBuyAmount,
        uint256,
        uint256,
        bool,
        address,
        bytes memory
    ) external returns (uint256 auctionId) {
        auctionId = auctions.length;
        auctioningToken.safeTransferFrom(msg.sender, address(this), auctionedSellAmount);
        auctions.push(
            Mauction(
                msg.sender,
                auctioningToken,
                biddingToken,
                auctionedSellAmount,
                minBuyAmount,
                block.timestamp,
                auctionEndDate,
                MauctionStatus.OPEN,
                bytes32(0)
            )
        );
    }

    /// @dev Requires allowances
    function placeBid(uint256 auctionId, Bid memory bid) external {
        auctions[auctionId].buy.safeTransferFrom(bid.bidder, address(this), bid.buyAmount);
        bids[auctionId] = bid;
    }

    /// Can only be called by the origin of the auction and only after auction.endTime is past
    function settleAuction(uint256 auctionId) external returns (bytes32 encodedOrder) {
        Mauction storage auction = auctions[auctionId];
        require(msg.sender == auction.origin, "only origin can claim");
        require(auction.status == MauctionStatus.OPEN, "auction already closed");
        require(auction.endTime <= block.timestamp, "too early to close auction");

        uint256 clearingSellAmount; // auction.sell token
        uint256 clearingBuyAmount; // auction.buy token
        Bid storage bid = bids[auctionId];
        if (bid.sellAmount > 0) {
            Fix a = toFix(auction.minBuyAmount).divu(auction.sellAmount);
            Fix b = toFix(bid.buyAmount).divu(bid.sellAmount);

            // The bid is at an acceptable price
            if (a.lte(b)) {
                clearingSellAmount = Math.min(bid.sellAmount, auction.sellAmount);
                clearingBuyAmount = b.mulu(clearingSellAmount).round();
                // .ceil() would be safer but we should simulate an uncaring auction mechanism
            }
        }

        // Transfer tokens
        auction.sell.safeTransfer(bid.bidder, clearingSellAmount);
        auction.sell.safeTransfer(auction.origin, auction.sellAmount - clearingSellAmount);
        auction.buy.safeTransfer(bid.bidder, bid.buyAmount - clearingBuyAmount);
        auction.buy.safeTransfer(auction.origin, clearingBuyAmount);
        auction.status = MauctionStatus.DONE;
        auction.endTime = 0;

        auction.encodedClearingOrder = _encodeOrder(
            0,
            uint96(clearingBuyAmount == 0 ? auction.sellAmount : clearingSellAmount),
            uint96(clearingBuyAmount == 0 ? auction.minBuyAmount : clearingBuyAmount)
        );
        return auction.encodedClearingOrder;
    }

    function auctionData(uint256 auctionId) external view returns (GnosisAuctionData memory data) {
        data.auctionEndDate = auctions[auctionId].endTime;
        data.clearingPriceOrder = auctions[auctionId].encodedClearingOrder;
    }

    function numAuctions() external view returns (uint256) {
        return auctions.length;
    }

    function _encodeOrder(
        uint64 userId,
        uint96 sellAmount,
        uint96 buyAmount
    ) internal pure returns (bytes32) {
        return bytes32((uint256(userId) << 192) + (uint256(sellAmount) << 96) + uint256(buyAmount));
    }
}
