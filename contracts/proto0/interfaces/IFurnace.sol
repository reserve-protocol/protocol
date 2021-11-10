// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/libraries/Fixed.sol";

/**
 * @title IFurnace
 * @notice A helper contract to burn RTokens slowly and permisionlessly.
 */
interface IFurnace {
    /// Emitted whenever RToken is burned
    /// @param amount {RTok} The amount burnt
    event Burned(uint256 indexed amount);
    /// Emitted whenever a distribution of RToken is set to be burnt
    /// @param amount {RTok} The total amount to be burnt over the period
    /// @param timePeriod {sec} The number of seconds the burn occurs over
    /// @param who The account that created the distribution
    event DistributionCreated(uint256 indexed amount, uint256 indexed timePeriod, address who);

    //

    /// Sets aside `amount` of RToken to be burnt over `timePeriod` seconds.
    /// @param amount {RTok} The amount of RToken to be burnt
    /// @param timePeriod {sec} The number of seconds to spread the burn over
    function burnOverPeriod(uint256 amount, uint256 timePeriod) external;

    /// Performs any burning that has vested since last call. Idempotent
    function doBurn() external;

    /// @return {RTok} The total amount of RToken that been burnt
    function totalBurnt() external view returns (uint256);
}
