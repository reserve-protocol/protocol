// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

enum AuctionStatus {
    NOT_YET_OPEN,
    OPEN,
    DONE
}

struct Auction {
    IERC20Metadata sell;
    IERC20Metadata buy;
    uint256 sellAmount; // {qSellTok}
    uint256 minBuyAmount; // {qBuyTok}
    uint256 startTime; // {sec}
    uint256 endTime; // {sec}
    uint256 clearingSellAmount; // only defined if status == DONE
    uint256 clearingBuyAmount; // only defined if status == DONE
    uint256 externalAuctionId; // only defined if status > NOT_YET_OPEN
    AuctionStatus status;
}

interface ITraderEvents {
    /// Emitted when an auction is started
    /// @param auctionId The index of the AssetManager.auctions array
    /// @param sell The token to sell
    /// @param buy The token to buy
    /// @param sellAmount {qSellTok} The quantity of the selling token
    /// @param minBuyAmount {qBuyTok} The minimum quantity of the buying token to accept
    event AuctionStarted(
        uint256 indexed auctionId,
        IERC20Metadata indexed sell,
        IERC20Metadata indexed buy,
        uint256 sellAmount,
        uint256 minBuyAmount
    );

    /// Emitted after an auction ends
    /// @param auctionId The index of the AssetManager.auctions array
    /// @param sellAmount {qSellTok} The quantity of the token sold
    /// @param buyAmount {qBuyTok} The quantity of the token bought
    event AuctionEnded(
        uint256 indexed auctionId,
        IERC20Metadata indexed sell,
        IERC20Metadata indexed buy,
        uint256 sellAmount,
        uint256 buyAmount
    );
}
