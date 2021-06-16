pragma solidity 0.8.4;



interface IStreamingAuctions {


    function registerPair(Pair storage pair)

    /// Called to launch an auction.
    function launchAuction(AuctionToken auctionToken, address buyingToken) external returns (bytes32);

    /// Called during an auction to adjust the volume, typically downwards.
    function adjustAuctionVolume(bytes32 auctionId, uint256 volume) external;

    /// Called after an auction has ended to get all the winnings. 
    function getWinnings(bytes32 auctionId) external;

}
