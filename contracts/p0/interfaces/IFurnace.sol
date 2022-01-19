// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/p0/interfaces/IERC20Receiver.sol";
import "contracts/libraries/Fixed.sol";

/**
 * @title IFurnace
 * @notice A helper contract to burn RTokens slowly and permisionlessly.
 */
interface IFurnace is IERC20Receiver {
    /// Emitted whenever RToken is melted
    /// @param amount {RTok} The amount melted
    event Melted(uint256 indexed amount);
    /// Emitted whenever a distribution of RToken is set to be melted
    /// @param amount {RTok} The total amount to be melted over the period
    /// @param timePeriod {sec} The number of seconds the melt occurs over
    /// @param who The account that created the distribution
    event DistributionCreated(uint256 indexed amount, uint256 indexed timePeriod, address who);

    //

    /// Performs any melting that has vested since last call. Idempotent
    function doMelt() external;

    function setBatchDuration(uint256 batchDuration) external;

    function batchDuration() external view returns (uint256);
}
