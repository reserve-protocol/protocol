// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "../libraries/Fixed.sol";
import "./IComponent.sol";

/**
 * @title IFurnace
 * @notice A helper contract to burn RTokens slowly and permisionlessly.
 */
interface IFurnace is IComponent {
    // Initialization
    function init(IMain main_, uint192 ratio_) external;

    /// Emitted when the melting ratio is changed
    /// @param oldRatio The old ratio
    /// @param newRatio The new ratio
    event RatioSet(uint192 oldRatio, uint192 newRatio);

    function ratio() external view returns (uint192);

    ///    Needed value range: [0, 1], granularity 1e-9
    /// @custom:governance
    function setRatio(uint192) external;

    /// Performs any RToken melting that has vested since the last payout.
    /// @custom:refresher
    function melt() external;
}

interface TestIFurnace is IFurnace {
    function lastPayout() external view returns (uint256);

    function lastPayoutBal() external view returns (uint256);
}
