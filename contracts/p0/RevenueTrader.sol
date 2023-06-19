// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IMain.sol";
import "../interfaces/IAssetRegistry.sol";
import "./mixins/Trading.sol";
import "./mixins/TradingLib.sol";

/// Trader Component that converts all asset balances at its address to a
/// single target asset and sends this asset to the Distributor.
contract RevenueTraderP0 is TradingP0, IRevenueTrader {
    using FixLib for uint192;
    using SafeERC20 for IERC20;

    IERC20 public tokenToBuy;

    function init(
        IMain main_,
        IERC20 tokenToBuy_,
        uint192 maxTradeSlippage_,
        uint192 minTradeVolume_
    ) public initializer {
        require(address(tokenToBuy_) != address(0), "invalid token address");
        __Component_init(main_);
        __Trading_init(maxTradeSlippage_, minTradeVolume_);
        tokenToBuy = tokenToBuy_;
    }

    /// Settle a single trade + distribute revenue
    /// @param sell The sell token in the trade
    /// @return trade The ITrade contract settled
    /// @custom:interaction
    function settleTrade(IERC20 sell)
        public
        override(ITrading, TradingP0)
        notTradingPausedOrFrozen
        returns (ITrade trade)
    {
        trade = super.settleTrade(sell);
        _distributeTokenToBuy();
        // unlike BackingManager, do _not_ chain trades; b2b trades of the same token are unlikely
    }

    /// Distribute tokenToBuy to its destinations
    /// @dev Special-case of manageTokens([tokenToBuy], *)
    /// @custom:interaction
    function distributeTokenToBuy() external notTradingPausedOrFrozen {
        _distributeTokenToBuy();
    }

    /// Process some number of tokens
    /// @param erc20s The ERC20s to manage; can be tokenToBuy or anything registered
    /// @param kinds The kinds of auctions to launch: DUTCH_AUCTION | BATCH_AUCTION
    /// @custom:interaction
    function manageTokens(IERC20[] memory erc20s, TradeKind[] memory kinds)
        external
        notTradingPausedOrFrozen
    {
        require(erc20s.length > 0, "empty erc20s list");
        require(erc20s.length == kinds.length, "length mismatch");
        main.assetRegistry().refresh();

        IAsset assetToBuy = main.assetRegistry().toAsset(tokenToBuy);
        (uint192 buyLow, uint192 buyHigh) = assetToBuy.lotPrice(); // {UoA/tok}
        require(buyHigh > 0 && buyHigh < FIX_MAX, "buy asset price unknown");

        // For each ERC20: start auction of given kind
        for (uint256 i = 0; i < erc20s.length; ++i) {
            IERC20 erc20 = erc20s[i];
            if (erc20 == tokenToBuy) {
                _distributeTokenToBuy();
                continue;
            }

            IAsset assetToSell = main.assetRegistry().toAsset(erc20);

            require(address(trades[erc20]) == address(0), "trade open");
            require(erc20.balanceOf(address(this)) > 0, "0 balance");

            (uint192 sellLow, uint192 sellHigh) = assetToSell.lotPrice(); // {UoA/tok}

            TradingLibP0.TradeInfo memory trade = TradingLibP0.TradeInfo({
                sell: assetToSell,
                buy: assetToBuy,
                sellAmount: assetToSell.bal(address(this)),
                buyAmount: 0,
                prices: TradePrices(sellLow, sellHigh, buyLow, buyHigh)
            });

            // Whether dust or not, trade the non-target asset for the target asset
            // Any asset with a broken price feed will trigger a revert here
            (, TradeRequest memory req) = TradingLibP0.prepareTradeSell(
                trade,
                minTradeVolume,
                maxTradeSlippage
            );
            require(req.sellAmount > 1, "sell amount too low");

            tryTrade(kinds[i], req, trade.prices);
        }
    }

    // === Internal ===

    /// Distribute tokenToBuy to its destinations
    /// @dev Assumes notTradingPausedOrFrozen has already been checked!
    function _distributeTokenToBuy() internal {
        uint256 bal = tokenToBuy.balanceOf(address(this));
        tokenToBuy.safeApprove(address(main.distributor()), 0);
        tokenToBuy.safeApprove(address(main.distributor()), bal);
        main.distributor().distribute(tokenToBuy, bal);
    }
}
