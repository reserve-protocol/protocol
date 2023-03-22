// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "../p1/RToken.sol";

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

    /// Claims rewards from all places they can accrue.
    function claimRewards(RTokenP1 rToken) external;

    /// To use this, call via callStatic.
    /// @return toStart The ERC20s that have auctions that can be started
    /// @custom:static-call
    function getRevenueAuctionERC20s(IRevenueTrader revenueTrader)
        external
        returns (IERC20[] memory toStart);

    /// To use this, first call:
    ///   - IFacadeAct.auctionsSettleable(revenueTrader)
    ///   - getRevenueAuctionERC20s(revenueTrader)
    /// If either arrays returned are non-empty, then can call this function.
    /// Logic:
    ///   For each ERC20 in `toSettle`:
    ///     - Settle any open ERC20 trades
    ///   For each ERC20 in `toStart`:
    ///     - Transfer any revenue for that ERC20 from the backingManager to revenueTrader
    ///     - Call `revenueTrader.manageToken(ERC20)` to start an auction, if possible
    function runRevenueAuctions(
        IRevenueTrader revenueTrader,
        IERC20[] memory toSettle,
        IERC20[] memory toStart
    ) external;
}
