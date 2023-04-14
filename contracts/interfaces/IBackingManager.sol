// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./IBroker.sol";
import "./IComponent.sol";
import "./ITrading.sol";

/**
 * @title IBackingManager
 * @notice The BackingManager handles changes in the ERC20 balances that back an RToken.
 *   - It computes which trades to perform, if any, and initiates these trades with the Broker.
 *   - If already collateralized, excess assets are transferred to RevenueTraders.
 *
 * `manageTokens(erc20s)` and `manageTokensSortedOrder(erc20s)` are handles for getting at the
 *   same underlying functionality. The former allows an ERC20 list in any order, while the
 *   latter requires a sorted array, and executes in O(n) rather than O(n^2) time. In the
 *   vast majority of cases we expect the the O(n^2) function to be acceptable.
 */
interface IBackingManager is IComponent, ITrading {
    /// Emitted when the trading delay is changed
    /// @param oldVal The old trading delay
    /// @param newVal The new trading delay
    event TradingDelaySet(uint48 indexed oldVal, uint48 indexed newVal);

    /// Emitted when the backing buffer is changed
    /// @param oldVal The old backing buffer
    /// @param newVal The new backing buffer
    event BackingBufferSet(uint192 indexed oldVal, uint192 indexed newVal);

    // Initialization
    function init(
        IMain main_,
        uint48 tradingDelay_,
        uint192 backingBuffer_,
        uint192 maxTradeSlippage_,
        uint192 minTradeVolume_,
        uint192 atomicTradingBias_,
        uint48 tradeCooldown_
    ) external;

    // Give RToken max allowance over a registered token
    /// @custom:refresher
    /// @custom:interaction
    function grantRTokenAllowance(IERC20) external;

    /// Maintain the overall backing policy; handout assets otherwise
    /// @dev Performs a uniqueness check on the erc20s list in O(n^2)
    /// @custom:interaction
    function manageTokens(IERC20[] memory erc20s) external;

    /// Maintain the overall backing policy; handout assets otherwise
    /// @dev Tokens must be in sorted order!
    /// @dev Performs a uniqueness check on the erc20s list in O(n)
    /// @custom:interaction
    function manageTokensSortedOrder(IERC20[] memory erc20s) external;

    /// Maintain the overall backing policy in an atomic swap with the caller
    /// Supports both exactInput and exactOutput swap methods
    /// @dev Caller must have granted tokenIn allowances for up to maxAmountIn
    /// @param tokenIn The input token, the one the caller provides
    /// @param tokenOut The output token, the one the protocol provides
    /// @param minAmountOut {qTokenOut} The minimum amount the swapper wants in output tokens
    /// @param maxAmountIn {qTokenIn} The most the swapper is willing to pay in input tokens
    /// @return The actual swap performed
    /// @custom:interaction
    function swap(
        IERC20 tokenIn,
        IERC20 tokenOut,
        uint256 maxAmountIn,
        uint256 minAmountOut
    ) external returns (Swap memory);

    /// @return The next Swap, without refreshing the assetRegistry
    function getSwap() external view returns (Swap memory);
}

interface TestIBackingManager is IBackingManager, TestITrading {
    function tradingDelay() external view returns (uint48);

    function backingBuffer() external view returns (uint192);

    function setTradingDelay(uint48 val) external;

    function setBackingBuffer(uint192 val) external;
}
