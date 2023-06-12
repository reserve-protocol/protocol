// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "../trading/GnosisTrade.sol";
import "../../interfaces/IMain.sol";
import "../../libraries/Fixed.sol";

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

/// A very simple trading partner that only supports 1 bid per auction, without fees
/// It does not mimic the behavior of EasyAuction directly
contract GnosisMock is IGnosis, IBiddable {
    using FixLib for uint192;
    using SafeERC20 for IERC20;

    uint256 public constant feeNumerator = 0; // Does not support a fee

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
    ) external virtual returns (uint256 auctionId) {
        require(auctionedSellAmount > 0, "sell amount is zero");
        auctionId = auctions.length;

        // Keep the fee
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
        require(bid.sellAmount <= auctions[auctionId].sellAmount, "invalid bid sell");
        require(bid.buyAmount > 0, "zero volume bid");
        auctions[auctionId].buy.safeTransferFrom(bid.bidder, address(this), bid.buyAmount);
        bids[auctionId] = bid;
    }

    /// Can only be called by the origin of the auction and only after auction.endTime is past
    function settleAuction(uint256 auctionId) external virtual returns (bytes32 encodedOrder) {
        Mauction storage auction = auctions[auctionId];
        require(auction.endTime <= block.timestamp, "too early to close auction");
        require(auction.status == MauctionStatus.OPEN, "auction already closed");
        auction.status = MauctionStatus.DONE;
        auction.endTime = 0;

        Bid storage bid = bids[auctionId];

        // No-bid case
        if (bid.bidder == address(0)) {
            auction.sell.safeTransfer(auction.origin, auction.sellAmount);
            auction.encodedClearingOrder = _encodeOrder(0, auction.sellAmount, 0);
            return auction.encodedClearingOrder;
        }

        // Transfer tokens
        auction.sell.safeTransfer(bid.bidder, bid.sellAmount);
        auction.buy.safeTransfer(auction.origin, bid.buyAmount);
        if (auction.sellAmount > bid.sellAmount) {
            auction.sell.safeTransfer(auction.origin, auction.sellAmount - bid.sellAmount);
        }

        // Encode clearing order
        auction.encodedClearingOrder = _encodeOrder(0, bid.sellAmount, bid.buyAmount);
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
        uint256 userId,
        uint256 sellAmount,
        uint256 buyAmount
    ) internal pure returns (bytes32) {
        return bytes32((userId << 192) + (sellAmount << 96) + buyAmount);
    }
}
