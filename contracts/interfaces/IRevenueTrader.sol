// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "./IComponent.sol";
import "./ITrading.sol";
import "./ISwapper.sol";

/**
 * @title IRevenueTrader
 * @notice The RevenueTrader is an extension of the trading mixin that trades all
 *   assets at its address for a single target asset. There are two runtime instances
 *   of the RevenueTrader, 1 for RToken and 1 for RSR.
 */
interface IRevenueTrader is IComponent, ITrading, ISwapper {
    // Initialization
    function init(
        IMain main_,
        IERC20 tokenToBuy_,
        uint192 maxTradeSlippage_,
        uint192 minTradeVolume_,
        uint48 dutchAuctionLength_
    ) external;

    /// Starts dutch auctions from the current block, unless they are already ongoing
    /// Callable only by BackingManager
    /// @custom:refresher
    function refreshAuctions() external;

    /// Processes a single token; unpermissioned
    /// @dev Intended to be used with multicall
    /// @custom:interaction
    function manageToken(IERC20 sell) external;

    /// @return The ongoing auction as a Swap
    function getDutchAuctionQuote(IERC20 tokenOut) external view returns (Swap memory);
}

// solhint-disable-next-line no-empty-blocks
interface TestIRevenueTrader is IRevenueTrader, TestITrading {
    function tokenToBuy() external view returns (IERC20);
}
