// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IFacadeAct.sol";

/**
 * @title Facade
 * @notice A Facade to help batch compound actions that cannot be done from an EOA, solely.
 */
contract FacadeAct is IFacadeAct {
    function claimRewards(IRToken rToken) public {
        IMain main = rToken.main();
        main.backingManager().claimRewards();
        main.rTokenTrader().claimRewards();
        main.rsrTrader().claimRewards();
    }

    /// To use this, first call:
    ///   - FacadeRead.auctionsSettleable(revenueTrader)
    ///   - FacadeRead.revenueOverview(revenueTrader)
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
        revenueTrader.main().backingManager().forwardRevenue(toStart);

        // Start auctions
        for (uint256 i = 0; i < toStart.length; ++i) {
            revenueTrader.manageToken(toStart[i], kind);
        }
    }
}
