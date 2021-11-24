// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

interface IMarket {
    /// @return auctionId
    function initiateAuction(
        address sell,
        address buy,
        uint256 sellAmount,
        uint256 minBuyAmount,
        uint256 auctionDuration
    ) external returns (uint256 auctionId);

    /// @param auctionId The external auction id
    /// @return clearingSellAmount
    /// @return clearingBuyAmount
    function clear(uint256 auctionId) external returns (uint256 clearingSellAmount, uint256 clearingBuyAmount);
}
