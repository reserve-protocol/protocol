// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "../interfaces/IBackingManager.sol";
import "../interfaces/IStRSRVotes.sol";
import "../interfaces/IRevenueTrader.sol";
import "../interfaces/IRToken.sol";

bytes1 constant MAJOR_VERSION_1 = bytes1("1");
bytes1 constant MAJOR_VERSION_2 = bytes1("2");
bytes1 constant MAJOR_VERSION_3 = bytes1("3");

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
    ///   Then:
    ///     - Transfer any revenue for that ERC20 from the backingManager to revenueTrader
    ///     - Call `revenueTrader.manageTokens(ERC20)` to start an auction
    function runRevenueAuctions(
        IRevenueTrader revenueTrader,
        IERC20[] memory toSettle,
        IERC20[] memory toStart,
        TradeKind[] memory kinds
    ) external;

    /// To use this, call via callStatic.
    /// If canStart is true, call backingManager.rebalance(). May require settling a
    /// trade first; see auctionsSettleable.
    /// @return canStart true iff a recollateralization auction can be started
    /// @return sell The sell token in the auction
    /// @return buy The buy token in the auction
    /// @return sellAmount {qSellTok} How much would be sold
    /// @custom:static-call
    function nextRecollateralizationAuction(IBackingManager bm)
        external
        returns (
            bool canStart,
            IERC20 sell,
            IERC20 buy,
            uint256 sellAmount
        );

    /// To use this, call via callStatic.
    /// @return erc20s The ERC20s that have auctions that can be started
    /// @return canStart If the ERC20 auction can be started
    /// @return surpluses {qTok} The surplus amount
    /// @return minTradeAmounts {qTok} The minimum amount worth trading
    /// @custom:static-call
    function revenueOverview(IRevenueTrader revenueTrader)
        external
        returns (
            IERC20[] memory erc20s,
            bool[] memory canStart,
            uint256[] memory surpluses,
            uint256[] memory minTradeAmounts
        );
}
