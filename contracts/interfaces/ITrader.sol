// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/libraries/Fixed.sol";
import "./IAsset.sol";
import "./IRewardable.sol";

struct ProposedAuction {
    IAsset sell;
    IAsset buy;
    uint256 sellAmount; // {qSellTok}
    uint256 minBuyAmount; // {qBuyTok}
}

enum AuctionStatus {
    ON,
    OFF
}

interface ITrader is IRewardable {
    /// Emitted when an auction is started
    /// @param oneshotAuction The address of the oneshot auction contract
    /// @param sell The token to sell
    /// @param buy The token to buy
    /// @param sellAmount {qSellTok} The quantity of the selling token
    /// @param minBuyAmount {qBuyTok} The minimum quantity of the buying token to accept
    event AuctionStarted(
        address indexed oneshotAuction,
        IERC20 indexed sell,
        IERC20 indexed buy,
        uint256 sellAmount,
        uint256 minBuyAmount
    );

    /// Emitted after an auction ends
    /// @param oneshotAuction The address of the oneshot auction contract
    /// @param sellAmount {qSellTok} The quantity of the token sold
    /// @param buyAmount {qBuyTok} The quantity of the token bought
    event AuctionEnded(
        address indexed oneshotAuction,
        IERC20 indexed sell,
        IERC20 indexed buy,
        uint256 sellAmount,
        uint256 buyAmount,
        AuctionStatus status
    );

    /// Settle any auctions that are due (past their end time)
    function closeDueAuctions() external;

    /// @return The current status of the trader
    function status() external view returns (AuctionStatus);
}
