// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.4;

/**
 * @title IFurnace
 * @notice A helper contract to burn RTokens slowly and permisionlessly.
 */
interface IFurnace {
    /// @notice Emitted whenever RToken is burned
    /// @param amount The amount burnt {qRToken}
    event Burn(uint256 indexed amount);
    /// @notice Emitted whenever a distribution of RToken is set to be burnt
    /// @param amount The total amount to be burnt over the period
    /// @param timePeriod The number of seconds the burn occurs over
    /// @param who The account that created the distribution
    event Distribution(uint256 indexed amount, uint256 indexed timePeriod, address who);

    //

    /// @notice Sets aside `amount` of RToken to be burnt over `timePeriod` seconds.
    /// @param amount The amount of RToken to be burnt {qRToken}
    /// @param timePeriod The number of seconds to spread the burn over
    function burnOverPeriod(uint256 amount, uint256 timePeriod) external;

    /// @notice Performs any burning that has vested since last call. Idempotent
    function doBurn() external;

    /// @notice Returns how much RToken has been burnt
    /// @return The total amount of RToken {qRToken} that been burnt
    function totalBurnt() external view returns (uint256);
}
