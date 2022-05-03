// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/libraries/Fixed.sol";
import "./IComponent.sol";
import "./ITrading.sol";

/**
 * @title IBackingManager
 * @notice The BackingManager handles changes in the ERC20 balances that back an RToken.
 *   - It computes which trades to perform, if any, and initiates these trades with the Broker.
 *   - If already capitalized, excess assets are transferred to RevenueTraders.
 */
interface IBackingManager is IComponent, ITrading {
    event TradingDelaySet(uint32 indexed oldVal, uint32 indexed newVal);
    event BackingBufferSet(int192 indexed oldVal, int192 indexed newVal);

    // Initialization
    function init(
        IMain main_,
        uint32 tradingDelay_,
        int192 backingBuffer_,
        int192 maxTradeSlippage_,
        int192 dustAmount_
    ) external;

    // Give RToken max allowance over a registered token
    /// @custom:refresher
    function grantRTokenAllowance(IERC20) external;

    /// Manage backing funds: maintain the overall backing policy
    /// @custom:action
    function manageFunds() external;
}

interface TestIBackingManager is IBackingManager, TestITrading {
    function tradingDelay() external view returns (uint32);

    function backingBuffer() external view returns (int192);

    function setTradingDelay(uint32 val) external;

    function setBackingBuffer(int192 val) external;
}
