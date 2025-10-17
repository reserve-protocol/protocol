// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../../plugins/trading/DutchTrade.sol";
import "../../interfaces/IAsset.sol";
import "../../interfaces/IAssetRegistry.sol";
import "../../interfaces/IRToken.sol";
import "../../interfaces/IStRSR.sol";
import "../../libraries/Fixed.sol";
import "../../p1/BasketHandler.sol";
import "../../p1/RToken.sol";
import "../../p1/Main.sol";
import "../../p1/AssetRegistry.sol";
import "../../p1/StRSRVotes.sol";

/**
 * @title TradeHelperFacet
 * @notice Facet for reading trading related information.
 */
// slither-disable-start
contract TradeHelperFacet {
    using FixLib for uint192;

    struct SingleBid {
        address tradeAddress;
        address sellToken;
        address buyToken;
        uint256 sellAmount;
        uint256 bidAmount;
    }

    function getAllOpenTradesForRToken(RTokenP1 rToken, uint48 timestamp)
        external
        view
        returns (SingleBid[] memory openTrades)
    {
        IMain main = rToken.main();

        IAssetRegistry assetRegistry = main.assetRegistry();

        IRevenueTrader rsrTrader = main.rsrTrader();
        IRevenueTrader rTokenTrader = main.rTokenTrader();
        IBackingManager backingTrader = main.backingManager();

        IERC20[] memory erc20s = assetRegistry.erc20s();

        address[] memory openTradeAddresses = new address[](erc20s.length * 3);
        uint256 numOpenTrades = 0;

        for (uint256 i = 0; i < erc20s.length; i++) {
            IERC20 erc20 = erc20s[i];

            ITrade trade1 = rsrTrader.trades(erc20);
            ITrade trade2 = rTokenTrader.trades(erc20);
            ITrade trade3 = backingTrader.trades(erc20);

            if (address(trade1) != address(0) && trade1.KIND() == TradeKind.DUTCH_AUCTION) {
                openTradeAddresses[numOpenTrades++] = address(trade1);
            }
            if (address(trade2) != address(0) && trade2.KIND() == TradeKind.DUTCH_AUCTION) {
                openTradeAddresses[numOpenTrades++] = address(trade2);
            }
            if (address(trade3) != address(0) && trade3.KIND() == TradeKind.DUTCH_AUCTION) {
                openTradeAddresses[numOpenTrades++] = address(trade3);
            }
        }

        openTrades = new SingleBid[](numOpenTrades);

        for (uint256 i = 0; i < numOpenTrades; i++) {
            DutchTrade trade = DutchTrade(openTradeAddresses[i]);

            IERC20 sellToken = trade.sell();
            IERC20 buyToken = trade.buy();

            uint256 sellAmount = trade.sellAmount(); // {qTok}
            uint256 minBuyAmount = trade.bidAmount(
                timestamp == 0 ? uint48(block.timestamp) : timestamp
            ); // {qTok}

            openTrades[i] = SingleBid({
                tradeAddress: address(trade),
                sellToken: address(sellToken),
                buyToken: address(buyToken),
                sellAmount: sellAmount,
                bidAmount: minBuyAmount
            });
        }
    }
}
// slither-disable-end
