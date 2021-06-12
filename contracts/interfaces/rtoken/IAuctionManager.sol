pragma solidity 0.8.4;

interface IAuctionManager {
    /// Called to launch an auction.
    function launchAuction(AuctionToken auctionToken, address buyingToken) external override returns (bytes32);

    /// Called during an auction to adjust the volume, typically downwards.
    function adjustAuctionVolume(bytes32 auctionId, uint256 volume) external override;

    /// Called after an auction has ended to get all the winnings. 
    function getWinnings(bytes32 auctionId) external override;
}
