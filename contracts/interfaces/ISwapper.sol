// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// A simple atomic swap
struct Swap {
    IERC20 sell; // the token the protocol is selling
    IERC20 buy; // the token the protocol is buying
    uint256 sellAmount; // {qSellTok}
    uint256 buyAmount; // {qBuyTok}
}

/**
 * @title ISwapper
 * @notice A Trader interface that supports atomic swaps
 */
interface ISwapper {
    // Emitted when an atomic swap is performed
    /// @param sell The ERC20 the protocol is selling
    /// @param buy The ERC20 the protocol is buying
    /// @param sellAmount {qSellTok} The quantity of the sell token
    /// @param buyAmount {qSellTok} The quantity of the buy token
    event SwapCompleted(
        IERC20 indexed sell,
        IERC20 indexed buy,
        uint256 sellAmount,
        uint256 buyAmount
    );

    /// Execute the available swap against the trader at the current dutch auction price
    /// @param tokenIn The ERC20 token provided by the caller
    /// @param tokenOut The ERC20 token being purchased by the caller
    /// @param amountOut {qTokenOut} The exact quantity of tokenOut being purchased
    /// @return The swap actually performed
    /// @custom:interaction
    function swap(
        IERC20 tokenIn,
        IERC20 tokenOut,
        uint256 amountOut
    ) external returns (Swap memory);
}
