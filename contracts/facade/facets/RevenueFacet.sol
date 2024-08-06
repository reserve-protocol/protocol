// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../../interfaces/IAssetRegistry.sol";
import "../../interfaces/IBackingManager.sol";
import "../../interfaces/IBasketHandler.sol";
import "../../interfaces/IRToken.sol";
import "../../libraries/Fixed.sol";
import "../lib/FacetLib.sol";

/**
 * @title AuctionsFacet
 * @notice Single-function facet to return all revenues that can be started across RTokens
 * @custom:static-call - Use ethers callStatic() to get result after update; do not execute
 */
// slither-disable-start
contract RevenueFacet {
    using FixLib for uint192;

    struct Revenue {
        IRToken rToken;
        IERC20 erc20;
        uint256 surplus;
    }

    Revenue[] _revenues; // empty at-rest

    /// Return revenues across multiple RTokens
    function revenues(IRToken[] memory rTokens)
        external
        returns (Revenue[] memory rTokenRevenues, Revenue[] memory rsrRevenues)
    {
        for (uint256 i = 0; i < rTokens.length; ++i) {
            IMain main = rTokens[i].main();
            IERC20[] memory erc20s = main.assetRegistry().erc20s();

            // Forward ALL revenue
            FacetLib.forwardRevenue(main.backingManager(), erc20s);

            IRevenueTrader rTokenTrader = main.rTokenTrader();
            IRevenueTrader rsrTrader = main.rsrTrader();
            for (uint256 j = 0; j < erc20s.length; ++j) {
                IERC20 erc20 = erc20s[j];

                // RTokenTrader -- Settle first if possible so have full available balances
                ITrade trade = rTokenTrader.trades(erc20);
                if (address(trade) != address(0) && trade.canSettle()) {
                    FacetLib.settleTrade(rTokenTrader, erc20);
                }
                _revenues.push(Revenue(rTokens[i], erc20, erc20.balanceOf(address(rTokenTrader))));

                // RSRTrader -- Settle first if possible so have full available balances
                trade = rsrTrader.trades(erc20);
                if (address(trade) != address(0) && trade.canSettle()) {
                    FacetLib.settleTrade(rsrTrader, erc20);
                }
                _revenues.push(Revenue(rTokens[i], erc20, erc20.balanceOf(address(rsrTrader))));
            }
        }

        // Empty storage queue in reverse order, we know evens are RSR revenues and odds are RToken
        rTokenRevenues = new Revenue[](_revenues.length / 2);
        rsrRevenues = new Revenue[](_revenues.length / 2);
        for (uint256 i = _revenues.length; i > 0; --i) {
            if (i % 2 == 0) rsrRevenues[i / 2] = _revenues[i];
            else rTokenRevenues[i / 2] = _revenues[i];
            delete _revenues[i];
        }
        assert(_revenues.length == 0);
    }
}
// slither-disable-end
