// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// The auction interface, currently mirrors Gnosis EasyAuction
/// https://github.com/gnosis/ido-contracts/blob/main/contracts/EasyAuction.sol
interface IMarket {
    /// Mirrors Gnosis EasyAuction
    function initiateAuction(
        IERC20 auctioningToken,
        IERC20 biddingToken,
        uint256 orderCancellationEndDate,
        uint256 auctionEndDate,
        uint96 auctionedSellAmount,
        uint96 minBuyAmount,
        uint256 minimumBiddingAmountPerOrder,
        uint256 minFundingThreshold,
        bool isAtomicClosureAllowed,
        address accessManagerContract,
        bytes memory accessManagerContractData
    ) external returns (uint256 auctionId);

    /// @param auctionId The external auction id
    /// @dev See here for decoding: https://github.com/gnosis/ido-contracts/blob/0160b0d06ec8055f62b50fc6b6999a9536f9dae8/contracts/libraries/IterableOrderedOrderSet.sol#L205
    /// @return encodedOrder The order, encoded in a bytes 32
    function settleAuction(uint256 auctionId) external returns (bytes32 encodedOrder);
}
