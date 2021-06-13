pragma solidity 0.8.4;

// TODO: BatchAuction will have to be modified significantly. This is where implementation of
// the rToken's relationship to BatchAuction will be (or, it will be simple enough to roll into
// the RToken contract itself. )
contract AuctionManager {

    function launchAuction(
        address sellingToken, 
        address buyingToken, 
        uint256 sellAmount
    ) external override {
        // TODO 
    }

    /// Called during an auction to adjust the volume, typically downwards.
    function adjustAuctionVolume(bytes32 auctionId, uint256 volume) external override {
        // TODO
    }

    /// Called after an auction has ended to get all the winnings. 
    function getWinnings(bytes32 auctionId) external override {
        // TODO
    }
}
