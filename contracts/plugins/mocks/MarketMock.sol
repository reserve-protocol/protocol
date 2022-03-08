// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/interfaces/IMarket.sol";
import "contracts/libraries/Fixed.sol";

interface ITrading {
    /// @param auctionId An internal auction id, not the one from AssetManager
    /// @param bid A Bid
    function placeBid(uint256 auctionId, Bid memory bid) external;
}

enum AuctionStatus {
    NOT_YET_OPEN,
    OPEN,
    DONE
}

/*
 *  Did you mean: Mauction
 */
struct MockAuction {
    address origin;
    IERC20 sell;
    IERC20 buy;
    uint256 sellAmount; // {qSellTok}
    uint256 minBuyAmount; // {qBuyTok}
    uint256 startTime; // {sec}
    uint256 endTime; // {sec}
    AuctionStatus status;
}

struct Bid {
    address bidder;
    uint256 sellAmount; // MockAuction.sell
    uint256 buyAmount; // MockAuction.buy
}

/// A very simple trading partner that only supports 1 bid per auction
contract MarketMock is IMarket, ITrading {
    using FixLib for Fix;
    using SafeERC20 for IERC20;

    MockAuction[] public auctions;
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
            MockAuction(
                msg.sender,
                auctioningToken,
                biddingToken,
                auctionedSellAmount,
                minBuyAmount,
                block.timestamp,
                auctionEndDate,
                AuctionStatus.OPEN
            )
        );
    }

    /// @dev Requires allowances
    function placeBid(uint256 auctionId, Bid memory bid) external {
        auctions[auctionId].buy.transferFrom(bid.bidder, address(this), bid.buyAmount);
        bids[auctionId] = bid;
    }

    /// Can only be called by the origin of the auction and only after auction.endTime is past
    function settleAuction(uint256 auctionId) external returns (bytes32 encodedOrder) {
        MockAuction storage auction = auctions[auctionId];
        require(msg.sender == auction.origin, "only origin can claim");
        require(auction.status == AuctionStatus.OPEN, "auction already closed");
        require(auction.endTime <= block.timestamp, "too early to close auction");

        uint256 clearingSellAmount;
        uint256 clearingBuyAmount;
        Bid storage bid = bids[auctionId];
        if (bid.sellAmount > 0) {
            Fix a = toFix(auction.minBuyAmount).divu(auction.sellAmount);
            Fix b = toFix(bid.buyAmount).divu(bid.sellAmount);

            // The bid is at an acceptable price
            if (a.lte(b)) {
                clearingSellAmount = Math.min(bid.sellAmount, auction.sellAmount);
                clearingBuyAmount = b.mulu(clearingSellAmount).round();
            }
        }

        // Transfer tokens
        auction.sell.safeTransfer(bid.bidder, clearingSellAmount);
        auction.sell.safeTransfer(auction.origin, auction.sellAmount - clearingSellAmount);
        auction.buy.safeTransfer(bid.bidder, bid.buyAmount - clearingBuyAmount);
        auction.buy.safeTransfer(auction.origin, clearingBuyAmount);
        auction.status = AuctionStatus.DONE;
        return _encodeOrder(0, uint96(clearingBuyAmount), uint96(clearingSellAmount));
    }

    function numAuctions() external view returns (uint256) {
        return auctions.length;
    }

    function _encodeOrder(
        uint64 userId,
        uint96 buyAmount,
        uint96 sellAmount
    ) internal pure returns (bytes32) {
        return bytes32((uint256(userId) << 192) + (uint256(buyAmount) << 96) + uint256(sellAmount));
    }
}
