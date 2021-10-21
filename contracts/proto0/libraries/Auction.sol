// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

library Auction {
    struct Info {
        address sellToken;
        address buyToken;
        uint256 sellAmount;
        uint256 minBuyAmount;
        uint256 startTime;
        uint256 endTime;
        bool open;
    }

    function start(
        Auction.Info storage self,
        address sellToken,
        address buyToken,
        uint256 sellAmount,
        uint256 minBuyAmount,
        uint256 endTime
    ) internal {
        self.sellToken = sellToken;
        self.buyToken = buyToken;
        self.sellAmount = sellAmount;
        self.minBuyAmount = minBuyAmount;
        self.startTime = block.timestamp;
        self.endTime = endTime;
        self.open = true;

        // TODO: batchAuction.initiateAuction()
    }

    function closeOut(Auction.Info storage self) internal {
        require(self.open, "already closed out");
        // TODO: batchAuction.claim();

        self.open = false;
    }
}
