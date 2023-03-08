// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "../libraries/Fixed.sol";

import "../interfaces/IAssetRegistry.sol";
import "../interfaces/IBroker.sol";
import "../p1/RToken.sol";
import "../p1/BackingManager.sol";
import "../p1/RevenueTrader.sol";

/**
 * @title Facade Monitor
 * @notice A UX-friendly layer for reading out the state of an RToken, specifically for the Monitor.
 * @custom:static-call - Use ethers callStatic() to get result after update; do not execute
 */
contract FacadeMonitor {
    using FixLib for uint192;

    struct TradeResponse {
        IERC20[] tradesToBeSettled;
        IERC20[] tradesToBeStarted;
    }

    function getTradesForBackingManager(RTokenP1 rToken)
        external
        returns (TradeResponse memory response)
    {
        IMain main = rToken.main();

        IAssetRegistry assetRegistry = IAssetRegistry(address(main.assetRegistry()));
        BackingManagerP1 backingManager = BackingManagerP1(address(main.backingManager()));

        IERC20[] memory erc20s = assetRegistry.erc20s();

        // Let's check if there are any trades that we can settle.
        if (backingManager.tradesOpen() > 0) {
            uint256 tradeSettleCount;
            IERC20[] memory tradesToBeSettled = new IERC20[](erc20s.length);

            for (uint256 i = 0; i < erc20s.length; ) {
                ITrade trade = backingManager.trades(erc20s[i]);
                if (address(trade) != address(0) && trade.canSettle()) {
                    tradesToBeSettled[tradeSettleCount] = erc20s[i];

                    unchecked {
                        ++tradeSettleCount;
                    }
                }

                unchecked {
                    ++i;
                }
            }

            response.tradesToBeSettled = tradesToBeSettled;
        }

        // Let's check if there are any trades we can start.
        uint48 tradesOpen = backingManager.tradesOpen();
        backingManager.manageTokens(erc20s);
        if (backingManager.tradesOpen() - tradesOpen != 0) {
            response.tradesToBeStarted = erc20s;
        }
    }

    function getTradesForRevenueTraders(RTokenP1 rToken)
        external
        returns (TradeResponse memory rTokenTraderResponse, TradeResponse memory rsrTraderResponse)
    {
        IMain main = rToken.main();

        IAssetRegistry assetRegistry = IAssetRegistry(address(main.assetRegistry()));
        RevenueTraderP1 rTokenTrader = RevenueTraderP1(address(main.rTokenTrader()));
        RevenueTraderP1 rsrTrader = RevenueTraderP1(address(main.rsrTrader()));

        IERC20[] memory erc20s = assetRegistry.erc20s();

        rTokenTraderResponse = getTradesForTrader(rTokenTrader, erc20s);
        rsrTraderResponse = getTradesForTrader(rsrTrader, erc20s);
    }

    function getTradesForTrader(RevenueTraderP1 trader, IERC20[] memory erc20s)
        internal
        returns (TradeResponse memory response)
    {
        uint256 erc20Count = erc20s.length;

        // Let's check if there are any trades that we can settle.
        if (trader.tradesOpen() > 0) {
            uint256 tradeSettleCount;
            IERC20[] memory tradesToBeSettled = new IERC20[](erc20Count);

            for (uint256 i = 0; i < erc20Count; ) {
                ITrade trade = trader.trades(erc20s[i]);

                if (address(trade) != address(0) && trade.canSettle()) {
                    tradesToBeSettled[tradeSettleCount] = erc20s[i];

                    unchecked {
                        ++tradeSettleCount;
                    }
                }

                unchecked {
                    ++i;
                }
            }

            response.tradesToBeSettled = tradesToBeSettled;
        }

        // Let's check if there are any trades we can start.
        uint48 tradesOpen = trader.tradesOpen();
        uint256 tradeStartCount;
        IERC20[] memory tradesToBeStarted = new IERC20[](erc20Count);

        for (uint256 i = 0; i < erc20Count; ) {
            trader.manageToken(erc20s[i]);

            uint48 newTradesOpen = trader.tradesOpen();

            if (newTradesOpen - tradesOpen != 0) {
                tradesToBeStarted[tradeStartCount] = erc20s[i];
                tradesOpen = newTradesOpen;

                unchecked {
                    ++tradeStartCount;
                }
            }

            unchecked {
                ++i;
            }
        }

        response.tradesToBeStarted = tradesToBeStarted;
    }
}
