// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/p0/interfaces/IERC20Receiver.sol";
import "contracts/libraries/Fixed.sol";

/**
 * @title IFurnace
 * @notice A helper contract to burn RTokens slowly and permisionlessly.
 */
interface IFurnace is IERC20Receiver {
    /// @param amount {qRTok} The total amount to be melted over the period
    /// @param end {sec} The timestamp the melt should end at
    /// @param who The account that created the distribution
    event DistributionCreated(uint256 indexed amount, uint256 indexed end, address who);

    /// Emitted when the batch duration is changed
    /// @param oldBatchDuration The old value of `batchDuration`
    /// @param newBatchDuration The new value of `batchDuration`
    event BatchDurationSet(uint256 indexed oldBatchDuration, uint256 indexed newBatchDuration);

    /// Performs any RToken burning that has vested since last call. Idempotent.
    function melt() external;

    function setBatchDuration(uint256 batchDuration) external;

    function batchDuration() external view returns (uint256);
}
