// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "../interfaces/IRevenueTrader.sol";
import "../interfaces/IRToken.sol";

/**
 * @title IFacadeAct
 * @notice A Facade to help batch compound actions that cannot be done from an EOA, solely. 
v */
interface IFacadeAct {
    /// Claims rewards from all places they can accrue.
    function claimRewards(IRToken rToken) external;

    /// To use this, first call:
    ///   - FacadeRead.auctionsSettleable(revenueTrader)
    ///   - FacadeRead.revenueOverview(revenueTrader)
    /// If either arrays returned are non-empty, then can execute this function productively.
    /// Logic:
    ///   For each ERC20 in `toSettle`:
    ///     - Settle any open ERC20 trades
    ///   For each ERC20 in `toStart`:
    ///     - Transfer any revenue for that ERC20 from the backingManager to revenueTrader
    ///     - Call `revenueTrader.manageToken(ERC20)` to start an auction, if possible
    function runRevenueAuctions(
        IRevenueTrader revenueTrader,
        IERC20[] memory toSettle,
        IERC20[] memory toStart,
        TradeKind kind
    ) external;
}
