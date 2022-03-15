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
    event AuctionDelaySet(uint256 indexed oldVal, uint256 indexed newVal);
    event BackingBufferSet(int192 indexed oldVal, int192 indexed newVal);

    // Give RToken max allowances over all registered tokens
    /// @custom:refresher
    function grantAllowances() external;

    /// Manage backing funds: maintain the overall backing policy
    /// @custom:action
    function manageFunds() external;
}
