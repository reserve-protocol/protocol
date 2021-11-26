// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IMarket {
    /// @return auctionId
    function initiateAuction(
        IERC20 sell,
        IERC20 buy,
        uint256 sellAmount,
        uint256 minBuyAmount,
        uint256 auctionDuration
    ) external returns (uint256 auctionId);

    /// @param auctionId The external auction id
    /// @return clearingSellAmount
    /// @return clearingBuyAmount
    function clear(uint256 auctionId) external returns (uint256 clearingSellAmount, uint256 clearingBuyAmount);
}
