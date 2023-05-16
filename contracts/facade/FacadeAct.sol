// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/Multicall.sol";
import "../interfaces/IFacadeAct.sol";

/**
 * @title Facade
 * @notice A Facade to help batch compound actions that cannot be done from an EOA, solely.
 *   For use with ^3.0.0 RTokens.
 */
contract FacadeAct is IFacadeAct, Multicall {
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

        // solhint-disable avoid-low-level-calls

        // Transfer revenue backingManager -> revenueTrader
        {
            address bm = address(revenueTrader.main().backingManager());

            // 3.0.0 BackingManager interface
            (bool success, ) = bm.call{ value: 0 }(
                abi.encodeWithSignature("forwardRevenue(address[])", toStart)
            );

            // Fallback to <=2.1.0 interface
            if (!success) {
                (success, ) = bm.call{ value: 0 }(
                    abi.encodeWithSignature("manageTokens(address[])", toStart)
                );
                require(success, "failed to forward revenue");
            }
        }

        // Start auctions
        address rt = address(revenueTrader);
        for (uint256 i = 0; i < toStart.length; ++i) {
            // 3.0.0 RevenueTrader interface
            (bool success, ) = rt.call{ value: 0 }(
                abi.encodeWithSignature("manageToken(address,uint8)", toStart[i], kind)
            );

            // Fallback to <=2.1.0 interface
            if (!success) {
                (success, ) = rt.call{ value: 0 }(
                    abi.encodeWithSignature("manageToken(address)", toStart[i])
                );
                require(success, "failed to start revenue auction");
            }
        }
        // solhint-enable avoid-low-level-calls
    }
}
