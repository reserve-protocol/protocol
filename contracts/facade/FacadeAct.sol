// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";
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
    using Address for address;
    using SafeERC20 for IERC20;
    using FixLib for uint192;

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
    ///   Then:
    ///     - Transfer any revenue for that ERC20 from the backingManager to revenueTrader
    ///     - Call `revenueTrader.manageTokens(ERC20)` to start an auction
    function runRevenueAuctions(
        IRevenueTrader revenueTrader,
        IERC20[] calldata toSettle,
        IERC20[] calldata toStart,
        TradeKind[] calldata kinds
    ) external {
        // Settle auctions
        for (uint256 i = 0; i < toSettle.length; ++i) {
            _settleTrade(revenueTrader, toSettle[i]);
        }

        // Transfer revenue backingManager -> revenueTrader
        _forwardRevenue(revenueTrader.main().backingManager(), toStart);

        // Start RevenueTrader auctions
        _runRevenueAuctions(revenueTrader, toStart, kinds);
    }

    // === Static Calls ===

    /// To use this, call via callStatic.
    /// Includes consideration of when to distribute the RevenueTrader tokenToBuy
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
        _forwardRevenue(revenueTrader.main().backingManager(), reg.erc20s);

        erc20s = new IERC20[](reg.erc20s.length);
        canStart = new bool[](reg.erc20s.length);
        surpluses = new uint256[](reg.erc20s.length);
        minTradeAmounts = new uint256[](reg.erc20s.length);
        // Calculate which erc20s should have auctions started
        for (uint256 i = 0; i < reg.erc20s.length; ++i) {
            erc20s[i] = reg.erc20s[i];

            // Settle first if possible. Required so we can assess full available balance
            ITrade trade = revenueTrader.trades(erc20s[i]);
            if (address(trade) != address(0) && trade.canSettle()) {
                _settleTrade(revenueTrader, erc20s[i]);
            }

            surpluses[i] = erc20s[i].balanceOf(address(revenueTrader));
            (uint192 lotLow, ) = reg.assets[i].lotPrice(); // {UoA/tok}
            if (lotLow == 0) continue;

            // {qTok} = {UoA} / {UoA/tok}
            minTradeAmounts[i] = minTradeVolume.safeDiv(lotLow, FLOOR).shiftl_toUint(
                int8(reg.assets[i].erc20Decimals())
            );

            if (
                surpluses[i] > minTradeAmounts[i] &&
                revenueTrader.trades(erc20s[i]) == ITrade(address(0))
            ) {
                canStart[i] = true;
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
                    _settleTrade(bm, erc20s[i]);
                    break; // backingManager can only have 1 trade open at a time
                }
            }
        }

        // If no auctions ongoing, try to find a new auction to start
        if (bm.tradesOpen() == 0) {
            _rebalance(bm);

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

    function _settleTrade(ITrading trader, IERC20 toSettle) private {
        bytes1 majorVersion = bytes(trader.version())[0];
        if (majorVersion == MAJOR_VERSION_3) {
            // Settle auctions
            trader.settleTrade(toSettle);
        } else if (majorVersion == MAJOR_VERSION_2 || majorVersion == MAJOR_VERSION_1) {
            // solhint-disable-next-line avoid-low-level-calls
            (bool success, ) = address(trader).call{ value: 0 }(
                // previous versions did not return anything
                abi.encodeWithSignature("settleTrade(address)", toSettle)
            );
            success = success; // hush warning
        } else {
            _revertUnrecognizedVersion();
        }
    }

    function _forwardRevenue(IBackingManager bm, IERC20[] memory toStart) private {
        bytes1 majorVersion = bytes(bm.version())[0];
        if (majorVersion == MAJOR_VERSION_3) {
            // solhint-disable-next-line no-empty-blocks
            try bm.forwardRevenue(toStart) {} catch {}
        } else if (majorVersion == MAJOR_VERSION_2 || majorVersion == MAJOR_VERSION_1) {
            address(bm).functionCall(abi.encodeWithSignature("manageTokens(address[])", toStart));
        } else {
            _revertUnrecognizedVersion();
        }
    }

    function _runRevenueAuctions(
        IRevenueTrader revenueTrader,
        IERC20[] memory toStart,
        TradeKind[] memory kinds
    ) private {
        bytes1 majorVersion = bytes(revenueTrader.version())[0];

        if (majorVersion == MAJOR_VERSION_3) {
            // solhint-disable-next-line no-empty-blocks
            try revenueTrader.manageTokens(toStart, kinds) {} catch {}
        } else if (majorVersion == MAJOR_VERSION_2 || majorVersion == MAJOR_VERSION_1) {
            for (uint256 i = 0; i < toStart.length; ++i) {
                address(revenueTrader.main().backingManager()).functionCall(
                    abi.encodeWithSignature("manageToken(address)", toStart[i])
                );
            }
        } else {
            _revertUnrecognizedVersion();
        }
    }

    function _rebalance(IBackingManager bm) private {
        bytes1 majorVersion = bytes(bm.version())[0];

        if (majorVersion == MAJOR_VERSION_3) {
            // solhint-disable-next-line no-empty-blocks
            try bm.rebalance(TradeKind.DUTCH_AUCTION) {} catch {}
        } else if (majorVersion == MAJOR_VERSION_2 || majorVersion == MAJOR_VERSION_1) {
            IERC20[] memory emptyERC20s = new IERC20[](0);
            address(bm).functionCall(
                abi.encodeWithSignature("manageTokens(address[])", emptyERC20s)
            );
        } else {
            _revertUnrecognizedVersion();
        }
    }

    function _revertUnrecognizedVersion() private pure {
        revert("unrecognized version");
    }
}
