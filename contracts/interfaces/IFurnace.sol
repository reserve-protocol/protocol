// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/libraries/Fixed.sol";
import "./IComponent.sol";

/**
 * @title IFurnace
 * @notice A helper contract to burn RTokens slowly and permisionlessly.
 */
interface IFurnace is IComponent {
    // Initialization
    function init(
        IMain main_,
        uint256 period_,
        int192 ratio_
    ) external;

    /// Emitted when the melting period is changed
    /// @param oldPeriod The old period
    /// @param newPeriod The new period
    event PeriodSet(uint256 indexed oldPeriod, uint256 indexed newPeriod);

    function period() external view returns (uint256);

    /// @custom:governance
    function setPeriod(uint256) external;

    /// Emitted when the melting ratio is changed
    /// @param oldRatio The old ratio
    /// @param newRatio The new ratio
    event RatioSet(int192 indexed oldRatio, int192 indexed newRatio);

    function ratio() external view returns (int192);

    /// @custom:governance
    ///    Needed value range: [0, 1], granularity 1e-9
    function setRatio(int192) external;

    /// Performs any RToken melting that has vested since the last payout.
    /// @custom:refresher
    function melt() external;
}
