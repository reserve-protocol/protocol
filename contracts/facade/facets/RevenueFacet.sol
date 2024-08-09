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
 * @title RevenueFacet
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
        IRevenueTrader trader;
        IERC20 sell;
        IERC20 buy;
        uint8 sellDecimals;
        bool settleable; // if trader.settleTrade() can be called (if can: must, to unblock)
        string symbol;
        uint192 volume; // {UoA} USD value of surplus balance
        uint256 balance; // {qTok} surplus balance
        uint256 minTradeAmount; // {qTok} min USD value worth trading
    }

    // === External ===

    /// Return revenues across multiple RTokens
    function revenues(IRToken[] memory rTokens) external returns (Revenue[] memory _revenues) {
        RevenueStorage storage $ = _getStorage();
        for (uint256 i = 0; i < rTokens.length; ++i) {
            IERC20 rsr = IERC20(address(rTokens[i].main().rsr()));
            Registry memory reg = rTokens[i].main().assetRegistry().getRegistry();

            // Forward ALL revenue
            FacetLib.forwardRevenue(rTokens[i].main().backingManager(), reg.erc20s);

            for (uint256 j = 0; j < reg.erc20s.length; ++j) {
                IERC20Metadata erc20 = IERC20Metadata(address(reg.erc20s[j]));

                (uint192 low, ) = reg.assets[j].price(); // {UoA/tok}
                if (low == 0) continue;

                for (uint256 traderIndex = 0; traderIndex < 2; ++traderIndex) {
                    IRevenueTrader trader = traderIndex == 0
                        ? rTokens[i].main().rTokenTrader()
                        : rTokens[i].main().rsrTrader();

                    // Settle first if possible to have full available balances
                    bool settleable = false;
                    if (
                        address(trader.trades(erc20)) != address(0) &&
                        trader.trades(erc20).canSettle()
                    ) {
                        settleable = true;
                        FacetLib.settleTrade(trader, erc20);
                    }

                    IERC20 wouldBuy;
                    if (address(trader.trades(erc20)) == address(0)) {
                        wouldBuy = traderIndex == 0 ? IERC20(address(rTokens[i])) : rsr;
                    }

                    $.revenues.push(
                        Revenue(
                            rTokens[i],
                            trader,
                            erc20,
                            wouldBuy,
                            erc20.decimals(),
                            settleable,
                            erc20.symbol(),
                            reg.assets[j].bal(address(trader)).mul(low, FLOOR), // volume
                            erc20.balanceOf(address(trader)), // balance
                            trader.minTradeVolume().safeDiv(low, FLOOR).shiftl_toUint(
                                int8(erc20.decimals())
                            ) // minTradeAmount
                        )
                    );
                }
            }
        }

        // Empty storage queues
        _revenues = new Revenue[]($.revenues.length);
        for (uint256 i = $.revenues.length; i > 0; --i) {
            _revenues[i - 1] = $.revenues[i - 1];
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
