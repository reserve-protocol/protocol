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
 * @notice Single-function facet to return all revenues accumulating across RTokens
 * @custom:static-call - Use ethers callStatic() to get result after update; do not execute
 */
// slither-disable-start
contract RevenueFacet {
    using FixLib for uint192;

    // keccak256(abi.encode(uint256(keccak256("RevenueFacet")) - 1)) & ~bytes32(uint256(0xff));
    bytes32 private constant REVENUE_STORAGE =
        0x531d6ab467582a10938423ef5fa94c1ce844452664ec58675da73580d2c39800;

    /// @custom:storage-location erc7201:RevenueFacet
    struct RevenueStorage {
        Revenue[] revenues;
    }

    struct Revenue {
        IRToken rToken;
        IERC20 erc20;
        uint256 surplus; // {qTok}
        uint192 value; // {UoA}
    }

    // === External ===

    /// Return revenues across multiple RTokens
    function revenues(IRToken[] memory rTokens)
        external
        returns (Revenue[] memory rTokenRevenues, Revenue[] memory rsrRevenues)
    {
        RevenueStorage storage $ = _getStorage();
        for (uint256 i = 0; i < rTokens.length; ++i) {
            IMain main = rTokens[i].main();
            Registry memory reg = main.assetRegistry().getRegistry();

            // Forward ALL revenue
            FacetLib.forwardRevenue(main.backingManager(), reg.erc20s);

            IRevenueTrader rTokenTrader = main.rTokenTrader();
            IRevenueTrader rsrTrader = main.rsrTrader();
            for (uint256 j = 0; j < reg.erc20s.length; ++j) {
                IERC20 erc20 = reg.erc20s[j];

                uint192 avg;
                {
                    (uint192 low, uint192 high) = reg.assets[j].price(); // {UoA/tok}
                    if (low == 0) continue;
                    avg = (low + high) / 2;
                }

                // RTokenTrader -- Settle first if possible so have full available balances
                ITrade trade = rTokenTrader.trades(erc20);
                if (address(trade) != address(0) && trade.canSettle()) {
                    FacetLib.settleTrade(rTokenTrader, erc20);
                }
                $.revenues.push(
                    Revenue(
                        rTokens[i],
                        erc20,
                        erc20.balanceOf(address(rTokenTrader)),
                        reg.assets[j].bal(address(rTokenTrader)).mul(avg, FLOOR)
                    )
                );

                // RSRTrader -- Settle first if possible so have full available balances
                trade = rsrTrader.trades(erc20);
                if (address(trade) != address(0) && trade.canSettle()) {
                    FacetLib.settleTrade(rsrTrader, erc20);
                }
                $.revenues.push(
                    Revenue(
                        rTokens[i],
                        erc20,
                        erc20.balanceOf(address(rsrTrader)),
                        reg.assets[j].bal(address(rsrTrader)).mul(avg, FLOOR)
                    )
                );
            }
        }

        // Empty storage queue in reverse order, we know evens are RSR revenues and odds are RToken
        rTokenRevenues = new Revenue[]($.revenues.length / 2);
        rsrRevenues = new Revenue[]($.revenues.length / 2);
        for (uint256 i = $.revenues.length; i > 0; --i) {
            if (i % 2 == 0) rsrRevenues[(i - 1) / 2] = $.revenues[i - 1];
            else rTokenRevenues[(i - 1) / 2] = $.revenues[i - 1];
            $.revenues.pop();
        }
        assert($.revenues.length == 0);
    }

    // === Private ===

    function _getStorage() private pure returns (RevenueStorage storage $) {
        assembly {
            $.slot := REVENUE_STORAGE
        }
    }
}
// slither-disable-end
