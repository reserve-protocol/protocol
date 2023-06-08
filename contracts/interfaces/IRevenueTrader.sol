// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "./IBroker.sol";
import "./IComponent.sol";
import "./ITrading.sol";

/**
 * @title IRevenueTrader
 * @notice The RevenueTrader is an extension of the trading mixin that trades all
 *   assets at its address for a single target asset. There are two runtime instances
 *   of the RevenueTrader, 1 for RToken and 1 for RSR.
 */
interface IRevenueTrader is IComponent, ITrading {
    // Initialization
    function init(
        IMain main_,
        IERC20 tokenToBuy_,
        uint192 maxTradeSlippage_,
        uint192 minTradeVolume_
    ) external;

    /// Process a single token
    /// @dev Intended to be used with multicall
    /// @param erc20 The ERC20 token to manage; can be tokenToBuy or anything registered
    /// @param kind TradeKind.DUTCH_AUCTION or TradeKind.BATCH_AUCTION
    /// @custom:interaction
    function manageToken(IERC20 erc20, TradeKind kind) external;

    /// Distribute tokenToBuy to its destinations
    /// @dev Special-case of manageToken(tokenToBuy, *)
    /// @custom:interaction
    function distributeTokenToBuy() external;
}

// solhint-disable-next-line no-empty-blocks
interface TestIRevenueTrader is IRevenueTrader, TestITrading {
    function tokenToBuy() external view returns (IERC20);
}
