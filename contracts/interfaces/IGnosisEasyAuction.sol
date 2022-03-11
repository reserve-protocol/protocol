// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// The relevant portion of the interface of the live Gnosis EasyAuction contract
/// https://github.com/gnosis/ido-contracts/blob/main/contracts/EasyAuction.sol
interface IGnosisEasyAuction {
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

    function auctionData(uint256 auctionId)
        external
        view
        returns (
            IERC20,
            IERC20,
            uint256,
            uint256 auctionEndDate,
            bytes32,
            uint256,
            uint256,
            bytes32,
            bytes32 clearingPriceOrder,
            uint96,
            bool,
            bool,
            uint256,
            uint256
        );

    /// @param auctionId The external auction id
    /// @dev See here for decoding: https://git.io/JMang
    /// @return encodedOrder The order, encoded in a bytes 32
    function settleAuction(uint256 auctionId) external returns (bytes32 encodedOrder);
}
