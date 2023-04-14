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
        uint192 minTradeVolume_,
        uint192 swapPricepoint_
    ) public initializer {
        require(address(tokenToBuy_) != address(0), "invalid token address");
        __Component_init(main_);
        __Trading_init(maxTradeSlippage_, minTradeVolume_, swapPricepoint_);
        tokenToBuy = tokenToBuy_;
    }

    /// Processes a single token; unpermissioned
    /// @dev Intended to be used with multicall
    /// @custom:interaction
    function manageToken(IERC20 erc20) external notTradingPausedOrFrozen {
        if (address(trades[erc20]) != address(0)) return;

        uint256 bal = erc20.balanceOf(address(this));
        if (bal == 0) return;

        if (erc20 == tokenToBuy) {
            erc20.safeApprove(address(main.distributor()), 0);
            erc20.safeApprove(address(main.distributor()), bal);
            main.distributor().distribute(erc20, bal);
            return;
        }

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
            openTrade(req);
        }
    }

    /// Perform a swap for the tokenToBuy
    /// @dev Caller must have granted tokenIn allowances
    /// @param tokenIn The input token, the one the caller provides
    /// @param tokenOut The output token, the one the protocol provides
    /// @param minAmountOut {qTokenOut} The minimum amount the swapper wants out
    /// @param maxAmountIn {qTokenIn} The most the swapper is willing to pay
    /// @return s The actual swap performed
    /// @custom:interaction
    function swap(
        IERC20 tokenIn,
        IERC20 tokenOut,
        uint256 maxAmountIn,
        uint256 minAmountOut
    ) external notPausedOrFrozen returns (Swap memory s) {
        // == Refresh ==
        main.assetRegistry().refresh();

        require(tokenIn == tokenToBuy, "wrong tokenIn");

        s = getSwap(tokenOut);

        // Require the calculated swap is better than the passed-in swap
        require(s.sell == tokenOut && s.buy == tokenIn, "swap tokens changed");
        require(s.sellAmount >= minAmountOut, "output amount fell");
        require(s.buyAmount <= maxAmountIn, "input amount increased");

        executeSwap(s);
    }

    /// @param sell The token the protocol is selling
    /// @return The next Swap, without refreshing the assetRegistry
    function getSwap(IERC20 sell) public view returns (Swap memory) {
        IAsset sellAsset = main.assetRegistry().toAsset(sell);
        TradeRequest memory req = TradeRequest(
            sellAsset,
            main.assetRegistry().toAsset(tokenToBuy),
            sellAsset.bal(address(this)),
            0 // unused, will be overwritten
        );

        return TradingLibP0.prepareSwap(req, swapPricepoint, SwapVariant.CALCULATE_BUY_AMOUNT);
    }
}
