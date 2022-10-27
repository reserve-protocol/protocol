// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "contracts/p1/RToken.sol";

/**
 * @title IFacadeAct
 * @notice A calldata-preparer, useful to MEV searchers and off-chain bots looking to progress an
 *   RToken. 
 *
 * - @custom:static-call - Use ethers callStatic() in order to get result after update
v */
interface IFacadeAct {
    /// Returns the next call a keeper of MEV searcher should make in order to progress the system
    /// Returns zero bytes to indicate no action should be made
    /// @dev Don't actually execute this!
    /// @custom:static-call
    function getActCalldata(RTokenP1 rToken) external returns (address to, bytes memory calldata_);

    /// Claims rewards from all places they can accrue. Can be targeted by getActCalldata
    function claimAndSweepRewards(RTokenP1 rToken) external;
}
