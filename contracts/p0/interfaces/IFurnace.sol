// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/libraries/Fixed.sol";
import "contracts/p0/interfaces/IERC20Receiver.sol";

/**
 * @title IFurnace
 * @notice A helper contract to burn RTokens slowly and permisionlessly.
 */
interface IFurnace is IERC20Receiver {
    /// Emitted whenever RToken is burned
    /// @param amount {RTok} The amount burnt
    event Burned(uint256 indexed amount);
    /// Emitted whenever a distribution of RToken is set to be burnt
    /// @param amount {RTok} The total amount to be burnt over the period
    /// @param timePeriod {sec} The number of seconds the burn occurs over
    /// @param who The account that created the distribution
    event DistributionCreated(uint256 indexed amount, uint256 indexed timePeriod, address who);

    //

    /// Performs any burning that has vested since last call. Idempotent
    function doBurn() external;

    function setBatchDuration(uint256 batchDuration) external;

    function batchDuration() external view returns (uint256);

    /// @return {RTok} The total amount of RToken that been burnt
    function totalBurnt() external view returns (uint256);
}
