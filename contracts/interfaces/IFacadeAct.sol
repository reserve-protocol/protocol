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
    /// Stake RSR on the StRSR instance and send StRSR token and voting weight back to the caller
    /// @dev Expected to be used as the second step of a multicall after RSR.permit()
    /// @param rsrAmount {qRSR} The amount of RSR to stake
    /// @param delegatee  The address that should have (entirety of) the caller's voting weight
    function stakeAndDelegate(
        IERC20 stRSR,
        uint256 rsrAmount,
        address delegatee,
        uint256 nonce,
        uint256 expiry,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;

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
