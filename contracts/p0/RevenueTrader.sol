// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IMain.sol";
import "../interfaces/IAssetRegistry.sol";
import "../libraries/DutchAuctionLib.sol";
import "./mixins/Trading.sol";
import "./mixins/TradingLib.sol";

/// Trader Component that converts all asset balances at its address to a
/// single target asset and sends this asset to the Distributor.
contract RevenueTraderP0 is TradingP0, IRevenueTrader {
    using DutchAuctionLib for DutchAuction;
    using FixLib for uint192;
    using SafeERC20 for IERC20;

    IERC20 public tokenToBuy;

    // outer keys: sell token
    // inner keys: dutch auction end times {s}
    mapping(IERC20 => mapping(uint48 => DutchAuction)) private dutchAuctions;

    function init(
        IMain main_,
        IERC20 tokenToBuy_,
        uint192 maxTradeSlippage_,
        uint192 minTradeVolume_,
        uint48 dutchAuctionLength_
    ) public initializer {
        require(address(tokenToBuy_) != address(0), "invalid token address");
        __Component_init(main_);
        __Trading_init(maxTradeSlippage_, minTradeVolume_, dutchAuctionLength_);
        tokenToBuy = tokenToBuy_;
    }

    /// Starts dutch auctions from the current block, unless they are already ongoing
    /// Callable only by BackingManager
    /// @custom:refresher
    function refreshAuctions() external {
        require(_msgSender() == address(main.backingManager()), "backing manager only");

        // safely reset tradeEnd
        if (tradeEnd + dutchAuctionLength <= block.timestamp) {
            tradeEnd = uint48(block.timestamp); // allows first bid to happen this block
        }
    }

    /// Settle a single trade
    function settleTrade(IERC20 sell) public override(ITrading, TradingP0) {
        super.settleTrade(sell);
        distributeTokenToBuy(tokenToBuy.balanceOf(address(this)));
    }

    /// Processes a single token; unpermissioned
    /// @dev Intended to be used with multicall
    /// @custom:interaction
    function manageToken(IERC20 erc20) external notTradingPausedOrFrozen {
        require(address(trades[erc20]) == address(0), "trade open");

        // == Refresh ==
        main.assetRegistry().refresh();
        main.furnace().melt();

        uint256 bal = erc20.balanceOf(address(this));
        require(bal > 0, "zero balance");

        if (erc20 == tokenToBuy) {
            distributeTokenToBuy(bal);
            return;
        }

        require(tradeEnd + dutchAuctionLength <= block.timestamp, "dutch auction ongoing");

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

    /// Executes an atomic swap for revenue via a dutch auction
    /// @dev Caller must have granted tokenIn allowances for required tokenIn bal
    /// @param tokenIn The ERC20 token provided by the caller
    /// @param tokenOut The ERC20 token being purchased by the caller
    /// @param amountOut {qTokenOut} The exact quantity of tokenOut being purchased
    /// @return s The exact Swap performed
    /// @custom:interaction RCEI
    function swap(
        IERC20 tokenIn,
        IERC20 tokenOut,
        uint256 amountOut
    ) external notTradingPausedOrFrozen returns (Swap memory s) {
        // == Refresh ==
        main.assetRegistry().refresh();
        main.furnace().melt();

        require(address(trades[tokenOut]) == address(0), "nonatomic trade ongoing");
        require(tokenIn == tokenToBuy, "will only buy tokenToBuy");
        require(tokenOut != tokenToBuy, "will not sell tokenToBuy");

        // executeSwap if storage auction already exists
        DutchAuction storage auction = dutchAuctions[tokenOut][tradeEnd];
        // endTrade may be in the future without a storage auction because of another token
        if (dutchAuctionExists() && auction.sell.erc20() == tokenOut) {
            return executeSwap(auction, amountOut);
        }

        require(dutchAuctionActive(), "no dutch auction ongoing");

        // bump tradeEnd if it is in the past
        if (tradeEnd <= block.timestamp) tradeEnd += dutchAuctionLength;
        IAsset sellAsset = main.assetRegistry().toAsset(tokenOut);

        // {sellTok}
        uint192 sellAmount = sellAsset.bal(address(this));
        dutchAuctions[tokenOut][tradeEnd] = DutchAuctionLib.makeAuction(
            sellAsset,
            main.assetRegistry().toAsset(tokenToBuy),
            sellAmount,
            minTradeVolume,
            maxTradeSlippage
        );

        // {sellTok}
        uint192 bidSellAmt = shiftl_toFix(amountOut, -int8(auction.sell.erc20Decimals()));

        // Complete bid + execute swap
        s = auction.bid(progression(), bidSellAmt);
        distributeTokenToBuy(tokenToBuy.balanceOf(address(this)));
    }

    /// @return The ongoing auction as a Swap
    function getDutchAuctionQuote(IERC20 tokenOut)
        external
        view
        notTradingPausedOrFrozen
        returns (Swap memory)
    {
        require(address(trades[tokenOut]) == address(0), "nonatomic trade ongoing");
        require(tokenOut != tokenToBuy, "will not sell tokenToBuy");

        DutchAuction storage auction = dutchAuctions[tokenOut][tradeEnd];
        // endTrade may be in the future without a storage auction because of another token
        if (dutchAuctionExists() && auction.sell.erc20() == tokenOut) {
            return auction.toSwap(progression());
        }

        require(dutchAuctionActive(), "no dutch auction ongoing");
        IAsset sellAsset = main.assetRegistry().toAsset(tokenOut);

        // {sellTok}
        uint192 sellAmount = sellAsset.bal(address(this));
        require(sellAmount > 0, "zero balance");
        DutchAuction memory memAuction = DutchAuctionLib.makeAuction(
            sellAsset,
            main.assetRegistry().toAsset(tokenToBuy),
            sellAmount,
            minTradeVolume,
            maxTradeSlippage
        );
        uint192 discount = tradeEnd > block.timestamp ? 0 : FIX_ONE;
        return memAuction.toSwap(progression() - discount);
    }

    // === Private ===

    /// Forward an amount of tokenToBuy through the distributor
    function distributeTokenToBuy(uint256 amount) private {
        tokenToBuy.safeApprove(address(main.distributor()), 0);
        tokenToBuy.safeApprove(address(main.distributor()), amount);
        main.distributor().distribute(tokenToBuy, amount);
    }

    /// @return If a dutch auction is active; may or may not exist in storage
    function dutchAuctionActive() private view returns (bool) {
        return
            tradeEnd + dutchAuctionLength > block.timestamp &&
            block.timestamp + dutchAuctionLength >= tradeEnd;
    }
}
