// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/utils/Multicall.sol";
import "../../plugins/trading/DutchTrade.sol";
import "../../plugins/trading/GnosisTrade.sol";
import "../../interfaces/IBackingManager.sol";
import "../lib/FacetLib.sol";

/**
 * @title ActFacet
 * @notice
 *   Facet to help batch compound actions that cannot be done from an EOA, solely.
 *   Compatible with 2.1.0, ^3.0.0, and ^4.0.0 RTokens.
 * @custom:static-call - Use ethers callStatic() to get result after update; do not execute
 */
// slither-disable-start
contract ActFacet is Multicall {
    using Address for address;
    using SafeERC20 for IERC20;
    using FixLib for uint192;

    function claimRewards(IRToken rToken) external {
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
    ///     - Call `revenueTrader.manageTokens(ERC20)` to start an auction
    function runRevenueAuctions(
        IRevenueTrader revenueTrader,
        IERC20[] calldata toSettle,
        IERC20[] calldata toStart,
        TradeKind[] calldata kinds
    ) external {
        // Settle auctions
        for (uint256 i = 0; i < toSettle.length; ++i) {
            FacetLib.settleTrade(revenueTrader, toSettle[i]);
        }

        // if 2.1.0, distribute tokenToBuy
        bytes1 majorVersion = bytes(revenueTrader.version())[0];
        if (toSettle.length > 0 && (majorVersion == bytes1("2") || majorVersion == bytes1("1"))) {
            address(revenueTrader).functionCall(
                abi.encodeWithSignature("manageToken(address)", revenueTrader.tokenToBuy())
            );
        }

        if (toStart.length == 0) return;

        // Transfer revenue backingManager -> revenueTrader
        FacetLib.forwardRevenue(revenueTrader.main().backingManager(), toStart);

        // Start RevenueTrader auctions
        FacetLib.runRevenueAuctions(revenueTrader, toStart, kinds);
    }

    // === Static Calls ===

    /// To use this, call via callStatic.
    /// Includes consideration of when to distribute the RevenueTrader tokenToBuy
    /// @return erc20s The ERC20s that have auctions that can be started
    /// @return canStart If the ERC20 auction can be started
    /// @return surpluses {qTok} The surplus amounts currently held, ignoring reward balances
    /// @return minTradeAmounts {qTok} The minimum amount worth trading
    /// @return bmRewards {qTok} The amounts would be claimed by backingManager.claimRewards()
    /// @return revTraderRewards {qTok} The amounts that would be claimed by trader.claimRewards()
    /// @dev Note that `surpluses` + `bmRewards` + `revTraderRewards`
    /// @custom:static-call
    function revenueOverview(IRevenueTrader revenueTrader)
        external
        returns (
            IERC20[] memory erc20s,
            bool[] memory canStart,
            uint256[] memory surpluses,
            uint256[] memory minTradeAmounts,
            uint256[] memory bmRewards,
            uint256[] memory revTraderRewards
        )
    {
        IBackingManager bm = revenueTrader.main().backingManager();
        uint192 minTradeVolume = revenueTrader.minTradeVolume(); // {UoA}
        Registry memory reg = revenueTrader.main().assetRegistry().getRegistry();

        // Forward ALL revenue
        FacetLib.forwardRevenue(bm, reg.erc20s);

        erc20s = new IERC20[](reg.erc20s.length);
        canStart = new bool[](reg.erc20s.length);
        surpluses = new uint256[](reg.erc20s.length);
        minTradeAmounts = new uint256[](reg.erc20s.length);
        bmRewards = new uint256[](reg.erc20s.length);
        revTraderRewards = new uint256[](reg.erc20s.length);

        // Calculate which erc20s should have auctions started
        for (uint256 i = 0; i < reg.erc20s.length; ++i) {
            erc20s[i] = reg.erc20s[i];

            // Settle first if possible. Required so we can assess full available balance
            ITrade trade = revenueTrader.trades(erc20s[i]);
            if (address(trade) != address(0) && trade.canSettle()) {
                FacetLib.settleTrade(revenueTrader, erc20s[i]);
            }

            surpluses[i] = erc20s[i].balanceOf(address(revenueTrader));
            (uint192 low, ) = reg.assets[i].price(); // {UoA/tok}
            if (low == 0) continue;

            // {qTok} = {UoA} / {UoA/tok}
            minTradeAmounts[i] = minTradeVolume.safeDiv(low, FLOOR).shiftl_toUint(
                int8(reg.assets[i].erc20Decimals())
            );

            if (
                surpluses[i] > minTradeAmounts[i] &&
                revenueTrader.trades(erc20s[i]) == ITrade(address(0))
            ) {
                canStart[i] = true;
            }
        }

        // Calculate rewards
        // Reward counts are disjoint with `surpluses` and `canStart`
        for (uint256 i = 0; i < reg.erc20s.length; ++i) {
            bmRewards[i] = reg.erc20s[i].balanceOf(address(bm));
            revTraderRewards[i] = reg.erc20s[i].balanceOf(address(revenueTrader));
        }
        for (uint256 i = 0; i < reg.erc20s.length; ++i) {
            // solhint-disable-next-line no-empty-blocks
            try bm.claimRewardsSingle(reg.erc20s[i]) {} catch {} // same between 2.1.0 and 3.0.0
            // solhint-disable-next-line no-empty-blocks
            try revenueTrader.claimRewardsSingle(reg.erc20s[i]) {} catch {}
        }
        for (uint256 i = 0; i < reg.erc20s.length; ++i) {
            bmRewards[i] = reg.erc20s[i].balanceOf(address(bm)) - bmRewards[i];
            revTraderRewards[i] =
                reg.erc20s[i].balanceOf(address(revenueTrader)) -
                revTraderRewards[i];
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
    function nextRecollateralizationAuction(IBackingManager bm, TradeKind kind)
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
                    FacetLib.settleTrade(bm, erc20s[i]);
                    break; // backingManager can only have 1 trade open at a time
                }
            }
        }

        // If no auctions ongoing, to find a new auction to start
        if (bm.tradesOpen() == 0) {
            FacetLib.rebalance(bm, kind);

            // Find the started auction
            for (uint256 i = 0; i < erc20s.length; ++i) {
                ITrade trade = ITrade(address(bm.trades(erc20s[i])));
                if (address(trade) != address(0)) {
                    canStart = true;
                    sell = trade.sell();
                    buy = trade.buy();
                    sellAmount = FacetLib.getSellAmount(trade);
                }
            }
        }
    }
}
// slither-disable-end
