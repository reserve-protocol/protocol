// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
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
        Revenue[] rsrRevenues;
        Revenue[] rTokenRevenues;
    }

    struct Revenue {
        IRToken rToken;
        IERC20Metadata erc20;
        string name;
        string symbol;
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
                IERC20Metadata erc20 = IERC20Metadata(address(reg.erc20s[j]));

                uint192 avg;
                {
                    (uint192 low, uint192 high) = reg.assets[j].price(); // {UoA/tok}
                    if (low == 0) continue;
                    avg = (low + high) / 2;
                }

                // RTokenTrader -- Settle first if possible so have full available balances
                if (
                    address(rTokenTrader.trades(erc20)) != address(0) &&
                    rTokenTrader.trades(erc20).canSettle()
                ) {
                    FacetLib.settleTrade(rTokenTrader, erc20);
                }
                uint256 surplus = erc20.balanceOf(address(rTokenTrader));
                if (surplus != 0) {
                    $.rTokenRevenues.push(
                        Revenue(
                            rTokens[i],
                            erc20,
                            erc20.name(),
                            erc20.symbol(),
                            surplus,
                            reg.assets[j].bal(address(rTokenTrader)).mul(avg, FLOOR)
                        )
                    );
                }

                // RSRTrader -- Settle first if possible so have full available balances
                if (
                    address(rsrTrader.trades(erc20)) != address(0) &&
                    rsrTrader.trades(erc20).canSettle()
                ) {
                    FacetLib.settleTrade(rsrTrader, erc20);
                }
                surplus = erc20.balanceOf(address(rsrTrader));
                if (surplus != 0) {
                    $.rsrRevenues.push(
                        Revenue(
                            rTokens[i],
                            erc20,
                            erc20.name(),
                            erc20.symbol(),
                            surplus,
                            reg.assets[j].bal(address(rsrTrader)).mul(avg, FLOOR)
                        )
                    );
                }
            }
        }

        // Empty storage queues
        rTokenRevenues = new Revenue[]($.rTokenRevenues.length);
        rsrRevenues = new Revenue[]($.rsrRevenues.length);
        for (uint256 i = $.rTokenRevenues.length; i > 0; --i) {
            rTokenRevenues[i - 1] = $.rTokenRevenues[i - 1];
            $.rTokenRevenues.pop();
        }
        for (uint256 i = $.rsrRevenues.length; i > 0; --i) {
            rsrRevenues[i - 1] = $.rsrRevenues[i - 1];
            $.rsrRevenues.pop();
        }
        assert($.rTokenRevenues.length == 0);
        assert($.rsrRevenues.length == 0);
    }

    // === Private ===

    function _getStorage() private pure returns (RevenueStorage storage $) {
        assembly {
            $.slot := REVENUE_STORAGE
        }
    }
}
// slither-disable-end
