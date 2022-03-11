// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "./IAsset.sol";
import "./IComponent.sol";
import "./ITrade.sol";

struct TradeRequest {
    IAsset sell;
    IAsset buy;
    uint256 sellAmount; // {qSellTok}
    uint256 minBuyAmount; // {qBuyTok}
}

/// Maintains a list of trading partners and deploys oneshot trade contracts for traders
interface IBroker is IComponent {
    event AuctionLengthSet(uint256 indexed oldVal, uint256 indexed newVal);
    event TradingEnabled(bool prevStatus);
    event TradingDisabled(bool prevStatus);

    /// Request a trade from the broker
    /// @dev Requires setting an allowance in advance
    function initiateTrade(TradeRequest memory req) external returns (ITrade);

    /// Only callable by one of the trading contracts the broker deploys
    function reportBadTrade() external;

    function disabled() external view returns (bool);

    function auctionLength() external view returns (uint256);
}
