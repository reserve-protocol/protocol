// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/IStRSR.sol";

/*
 * @title IStRSR
 * @notice A rebasing token that represents claims on staked RSR and entitles the AssetManager to seize RSR.
 * @dev The p0-specific IStRSR
 */
interface IStRSR is IStRSRCommon {
    /// AssetManager only
    /// @param amount {qRSR}
    function seizeRSR(uint256 amount) external;
}
