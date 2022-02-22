// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/p0/interfaces/IERC20Receiver.sol";
import "contracts/libraries/Fixed.sol";

/**
 * @title IFurnace
 * @notice A helper contract to burn RTokens slowly and permisionlessly.
 */
interface IFurnace is IERC20Receiver {
    /// Emitted when the melting period is changed
    /// @param oldPeriod The old period
    /// @param newPeriod The new period
    event PeriodSet(uint256 indexed oldPeriod, uint256 indexed newPeriod);

    function period() external view returns (uint256);

    function setPeriod(uint256) external;

    /// Emitted when the melting ratio is changed
    /// @param oldRatio The old ratio
    /// @param newRatio The new ratio
    event RatioSet(Fix indexed oldRatio, Fix indexed newRatio);

    function ratio() external view returns (Fix);

    function setRatio(Fix) external;

    /// Performs any RToken melting that has vested since the last payout. Idempotent.
    /// @returns amount How much RToken was melted
    function melt() external returns (uint256 amount);
}
