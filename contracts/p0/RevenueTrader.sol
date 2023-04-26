// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

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
    /// @return trade The ITrade contract settled
    /// @custom:interaction
    function settleTrade(IERC20 sell)
        public
        override(ITrading, TradingP0)
        notTradingPausedOrFrozen
        returns (ITrade trade)
    {
        trade = super.settleTrade(sell);
        distributeTokenToBuy();

        // no need to try to start another auction
        // back-to-back revenue auctions for the same sell token are unlikely
    }

    /// Processes a single token; unpermissioned
    /// @dev Intended to be used with multicall
    /// @param kind TradeKind.DUTCH_AUCTION or TradeKind.BATCH_AUCTION
    /// @custom:interaction
    function manageToken(IERC20 erc20, TradeKind kind) external notTradingPausedOrFrozen {
        if (erc20 == tokenToBuy) {
            distributeTokenToBuy();
            return;
        }

        // if open trade: settle or revert
        if (address(trades[erc20]) != address(0)) {
            settleTrade(erc20);
        }

        if (erc20.balanceOf(address(this)) == 0) return;

        // Try to launch another auction

        IAssetRegistry reg = main.assetRegistry();
        IAsset sell = reg.toAsset(erc20);
        IAsset buy = reg.toAsset(tokenToBuy);
        (uint192 sellPrice, ) = sell.price(); // {UoA/tok}
        (, uint192 buyPrice) = buy.price(); // {UoA/tok}

        require(buyPrice > 0 && buyPrice < FIX_MAX, "buy asset price unknown");

        TradingLibP0.TradeInfo memory trade = TradingLibP0.TradeInfo({
            sell: sell,
            buy: buy,
            sellAmount: sell.bal(address(this)),
            buyAmount: 0,
            sellPrice: sellPrice,
            buyPrice: buyPrice
        });

        // If not dust, trade the non-target asset for the target asset
        // Any asset with a broken price feed will trigger a revert here
        (bool launch, TradeRequest memory req) = TradingLibP0.prepareTradeSell(
            trade,
            minTradeVolume,
            maxTradeSlippage
        );

        if (launch) {
            tryTrade(kind, req);
        }
    }

    // === Private ===

    function distributeTokenToBuy() private {
        uint256 bal = tokenToBuy.balanceOf(address(this));
        tokenToBuy.safeApprove(address(main.distributor()), 0);
        tokenToBuy.safeApprove(address(main.distributor()), bal);
        main.distributor().distribute(tokenToBuy, bal);
    }
}
