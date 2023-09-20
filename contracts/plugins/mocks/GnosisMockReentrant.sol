// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../../interfaces/ITrade.sol";
import "../../libraries/Fixed.sol";
import "./GnosisMock.sol";

/// A Gnosis Mock that attemts to reenter on initiateAuction
// Simply used for a specific test, not intended to provide valuable functionality
contract GnosisMockReentrant is GnosisMock {
    using FixLib for uint192;
    using SafeERC20 for IERC20;

    bool public reenterOnInit;
    bool public reenterOnSettle;

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
    ) external override returns (uint256 auctionId) {
        require(auctionedSellAmount > 0, "sell amount is zero");
        auctionId = auctions.length;

        // Reentrancy
        if (reenterOnInit) {
            ITrade(msg.sender).settle();
        }

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

    /// Can only be called by the origin of the auction and only after auction.endTime is past
    function settleAuction(uint256 auctionId) external override returns (bytes32 encodedOrder) {
        Mauction storage auction = auctions[auctionId];
        require(auction.endTime <= block.timestamp, "too early to close auction");
        require(auction.status == MauctionStatus.OPEN, "auction already closed");
        auction.status = MauctionStatus.DONE;
        auction.endTime = 0;

        Bid storage bid = bids[auctionId];

        // Reentrancy
        if (reenterOnSettle) {
            ITrade(msg.sender).settle();
        }

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

    function setReenterOnInit(bool value) external {
        reenterOnInit = value;
    }

    function setReenterOnSettle(bool value) external {
        reenterOnSettle = value;
    }
}
