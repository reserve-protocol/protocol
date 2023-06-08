// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/Multicall.sol";
import "../plugins/trading/DutchTrade.sol";
import "../interfaces/IBackingManager.sol";
import "../interfaces/IFacadeAct.sol";
import "../interfaces/IFacadeRead.sol";

/**
 * @title Facade
 * @notice A Facade to help batch compound actions that cannot be done from an EOA, solely.
 *   For use with ^3.0.0 RTokens.
 */
contract FacadeAct is IFacadeAct, Multicall {
    using SafeERC20 for IERC20;
    using FixLib for uint192;

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
    ) external {
        // Take in RSR from caller
        stRSR.safeTransferFrom(msg.sender, address(this), rsrAmount); // requires approvals first

        // Stake RSR
        stRSR.approve(address(stRSR), type(uint256).max); // safeApprove worse
        IStRSR(address(stRSR)).stake(rsrAmount);

        // Send StRSR to caller
        stRSR.safeTransfer(msg.sender, stRSR.balanceOf(address(this))); // give all StRSR!

        // Delegate by sig
        IStRSRVotes(address(stRSR)).delegateBySig(delegatee, nonce, expiry, v, r, s);
    }

    function claimRewards(IRToken rToken) public {
        IMain main = rToken.main();
        main.backingManager().claimRewards();
        main.rTokenTrader().claimRewards();
        main.rsrTrader().claimRewards();
    }

    /// To use this, first call:
    ///   - auctionsSettleable(revenueTrader)
    ///   - revenueOverview(revenueTrader)
    /// If either arrays returned are non-empty, then can execute this function productively.
    /// Logic:
    ///   For each ERC20 in `toSettle`:
    ///     - Settle any open ERC20 trades
    ///   For each ERC20 in `toStart`:
    ///     - Transfer any revenue for that ERC20 from the backingManager to revenueTrader
    ///     - Call `revenueTrader.manageToken(ERC20)` to start an auction
    function runRevenueAuctions(
        IRevenueTrader revenueTrader,
        IERC20[] memory toSettle,
        IERC20[] memory toStart,
        TradeKind kind
    ) external {
        // Settle auctions
        for (uint256 i = 0; i < toSettle.length; ++i) {
            revenueTrader.settleTrade(toSettle[i]);
        }

        // Transfer revenue backingManager -> revenueTrader
        {
            IBackingManager bm = revenueTrader.main().backingManager();
            bytes1 majorVersion = bytes(bm.version())[0];

            if (majorVersion == MAJOR_VERSION_3) {
                // solhint-disable-next-line no-empty-blocks
                try bm.forwardRevenue(toStart) {} catch {}
            } else if (majorVersion == MAJOR_VERSION_2 || majorVersion == MAJOR_VERSION_1) {
                // solhint-disable-next-line avoid-low-level-calls
                (bool success, ) = address(bm).call{ value: 0 }(
                    abi.encodeWithSignature("manageTokens(address[])", toStart)
                );
                success = success; // hush warning
            } else {
                revertUnrecognizedVersion();
            }
        }

        // Start auctions
        for (uint256 i = 0; i < toStart.length; ++i) {
            bytes1 majorVersion = bytes(revenueTrader.version())[0];

            if (majorVersion == MAJOR_VERSION_3) {
                // solhint-disable-next-line no-empty-blocks
                try revenueTrader.manageToken(toStart[i], kind) {} catch {}
            } else if (majorVersion == MAJOR_VERSION_2 || majorVersion == MAJOR_VERSION_1) {
                // solhint-disable-next-line avoid-low-level-calls
                (bool success, ) = address(revenueTrader).call{ value: 0 }(
                    abi.encodeWithSignature("manageToken(address)", toStart[i])
                );
                success = success; // hush warning
            } else {
                revertUnrecognizedVersion();
            }
        }
    }

    // === Static Calls ===

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
        )
    {
        uint192 minTradeVolume = revenueTrader.minTradeVolume(); // {UoA}
        Registry memory reg = revenueTrader.main().assetRegistry().getRegistry();

        // Forward ALL revenue
        {
            IBackingManager bm = revenueTrader.main().backingManager();
            bytes1 majorVersion = bytes(bm.version())[0];

            if (majorVersion == MAJOR_VERSION_3) {
                // solhint-disable-next-line no-empty-blocks
                try bm.forwardRevenue(reg.erc20s) {} catch {}
            } else if (majorVersion == MAJOR_VERSION_2 || majorVersion == MAJOR_VERSION_1) {
                // solhint-disable-next-line avoid-low-level-calls
                (bool success, ) = address(bm).call{ value: 0 }(
                    abi.encodeWithSignature("manageTokens(address[])", reg.erc20s)
                );
                success = success; // hush warning
            } else {
                revertUnrecognizedVersion();
            }
        }

        erc20s = new IERC20[](reg.erc20s.length);
        canStart = new bool[](reg.erc20s.length);
        surpluses = new uint256[](reg.erc20s.length);
        minTradeAmounts = new uint256[](reg.erc20s.length);
        // Calculate which erc20s can have auctions started
        for (uint256 i = 0; i < reg.erc20s.length; ++i) {
            // Settle first if possible. Required so we can assess full available balance
            ITrade trade = revenueTrader.trades(reg.erc20s[i]);
            if (address(trade) != address(0) && trade.canSettle()) {
                revenueTrader.settleTrade(reg.erc20s[i]);
            }

            uint48 tradesOpen = revenueTrader.tradesOpen();
            erc20s[i] = reg.erc20s[i];
            surpluses[i] = reg.erc20s[i].balanceOf(address(revenueTrader));

            (uint192 lotLow, ) = reg.assets[i].lotPrice(); // {UoA/tok}
            if (lotLow == 0) continue;

            // {qTok} = {UoA} / {UoA/tok}
            minTradeAmounts[i] = minTradeVolume.div(lotLow).shiftl_toUint(
                int8(reg.assets[i].erc20Decimals())
            );

            bytes1 majorVersion = bytes(revenueTrader.version())[0];
            if (
                reg.erc20s[i].balanceOf(address(revenueTrader)) > minTradeAmounts[i] &&
                revenueTrader.trades(reg.erc20s[i]) == ITrade(address(0))
            ) {
                if (majorVersion == MAJOR_VERSION_3) {
                    // solhint-disable-next-line no-empty-blocks
                    try revenueTrader.manageToken(erc20s[i], TradeKind.DUTCH_AUCTION) {} catch {}
                } else if (majorVersion == MAJOR_VERSION_2 || majorVersion == MAJOR_VERSION_1) {
                    // solhint-disable-next-line avoid-low-level-calls
                    (bool success, ) = address(revenueTrader).call{ value: 0 }(
                        abi.encodeWithSignature("manageToken(address)", erc20s[i])
                    );
                    success = success; // hush warning
                } else {
                    revertUnrecognizedVersion();
                }

                if (revenueTrader.tradesOpen() - tradesOpen > 0) {
                    canStart[i] = true;
                }
            }
        }
    }

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
        )
    {
        IERC20[] memory erc20s = bm.main().assetRegistry().erc20s();

        // Settle any settle-able open trades
        if (bm.tradesOpen() > 0) {
            for (uint256 i = 0; i < erc20s.length; ++i) {
                ITrade trade = bm.trades(erc20s[i]);
                if (address(trade) != address(0) && trade.canSettle()) {
                    bm.settleTrade(erc20s[i]);
                    break; // backingManager can only have 1 trade open at a time
                }
            }
        }

        // If no auctions ongoing, try to find a new auction to start
        if (bm.tradesOpen() == 0) {
            bytes1 majorVersion = bytes(bm.version())[0];

            if (majorVersion == MAJOR_VERSION_3) {
                // solhint-disable-next-line no-empty-blocks
                try bm.rebalance(TradeKind.DUTCH_AUCTION) {} catch {}
            } else if (majorVersion == MAJOR_VERSION_2 || majorVersion == MAJOR_VERSION_1) {
                IERC20[] memory emptyERC20s = new IERC20[](0);
                // solhint-disable-next-line avoid-low-level-calls
                (bool success, ) = address(bm).call{ value: 0 }(
                    abi.encodeWithSignature("manageTokens(address[])", emptyERC20s)
                );
                success = success; // hush warning
            } else {
                revertUnrecognizedVersion();
            }

            // Find the started auction
            for (uint256 i = 0; i < erc20s.length; ++i) {
                DutchTrade trade = DutchTrade(address(bm.trades(erc20s[i])));
                if (address(trade) != address(0)) {
                    canStart = true;
                    sell = trade.sell();
                    buy = trade.buy();
                    sellAmount = trade.sellAmount();
                }
            }
        }
    }

    // === Private ===

    function revertUnrecognizedVersion() private pure {
        revert("unrecognized version");
    }
}
