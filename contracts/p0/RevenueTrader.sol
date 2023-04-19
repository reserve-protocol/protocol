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

    // mapping from sell tokens to timestamp of last trade in that token
    mapping(IERC20 => uint48) private tradeEnds; // {s} timestamp of the end of the last trade

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

    /// Settle a single trade
    /// @custom:interaction
    function settleTrade(IERC20 sell) public override(ITrading, TradingP0) {
        tradeEnds[sell] = uint48(block.timestamp);
        super.settleTrade(sell); // has interactions, so must go second
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

    /// Executes an atomic swap for revenue via a dutch auction
    /// @dev Caller must have granted tokenIn allowances for required tokenIn bal
    /// @dev To get required tokenIn bal, use ethers.callstatic and look at the swap's buyAmount
    /// @param tokenIn The ERC20 token provided by the caller
    /// @param tokenOut The ERC20 token being purchased by the caller
    /// @param amountOut {qTokenOut} The exact quantity of tokenOut being purchased
    /// @return The exact Swap performed
    /// @custom:interaction RCEI
    function swap(
        IERC20 tokenIn,
        IERC20 tokenOut,
        uint256 amountOut
    ) external returns (Swap memory) {
        // == Refresh ==
        main.assetRegistry().refresh();
        // should melt() here too; TODO when we add to manageToken()

        // === Checks + Effects ===

        DutchAuction storage auction = ensureDutchAuction(tokenOut);
        // after dutchAuction(), we _know_ that tradeEnd > block.timestamp

        require(auction.buy.erc20() == tokenIn, "buy token mismatch");
        require(auction.sell.erc20() == tokenOut, "sell token mismatch");

        // {buyTok}
        uint192 bidBuyAmt = shiftl_toFix(amountOut, -int8(auction.buy.erc20Decimals()));

        // === Interactions ===

        // Complete bid + swap
        return
            auction.bid(
                divuu(block.timestamp - tradeEnds[tokenOut], dutchAuctionLength),
                bidBuyAmt
            );
    }

    /// To be used via callstatic
    /// Should not change the dutch auction logic if accidentally called
    /// @dev To be iterated over by a Facade using the assetRegistry.erc20s()
    /// @custom:static-call
    function getSwap(IERC20 tokenOut) external returns (Swap memory s) {
        // == Refresh ==
        main.assetRegistry().refresh();
        // should melt() here too; TODO when we add to manageToken()

        // === Checks + Effects ===

        uint48 tradeEnd = tradeEnds[tokenOut];
        DutchAuction storage auction = ensureDutchAuction(tokenOut);
        // after dutchAuction(), we _know_ that tradeEnd > block.timestamp

        // {buyTok/sellTok}
        uint192 price = DutchAuctionLib.currentPrice(
            divuu(block.timestamp - tradeEnd, dutchAuctionLength),
            auction.middlePrice,
            auction.lowPrice
        );

        // {buyTok} = {sellTok} * {buyTok/sellTok}
        uint192 buyAmount = auction.sellAmount.mul(price, CEIL);

        s = Swap(
            auction.sell.erc20(),
            auction.buy.erc20(),
            auction.sellAmount.shiftl_toUint(int8(auction.sell.erc20Decimals()), FLOOR),
            buyAmount.shiftl_toUint(int8(auction.buy.erc20Decimals()), CEIL)
        );
    }

    // === Private ===

    /// Ensures a dutch auction exists and returns it, or reverts
    /// After returning, endTrade is > block.timestamp
    function ensureDutchAuction(IERC20 sell) private returns (DutchAuction storage auction) {
        require(dutchAuctionOngoing(sell), "no dutch auction ongoing");
        uint48 tradeEnd = tradeEnds[sell];

        auction = dutchAuctions[sell][tradeEnd];
        if (tradeEnd > block.timestamp) {
            return auction;
        }
        // else: virtual ongoing auction; ie tradeEnd <= block.timestamp by dutchAuctionLength

        IAsset sellAsset = main.assetRegistry().toAsset(sell);
        IAsset buyAsset = main.assetRegistry().toAsset(tokenToBuy);

        // {sellTok}
        uint192 sellAmount = sellAsset.bal(address(this));

        // at this point: the auction is virtual, make it real and advance the tradeEnd
        tradeEnds[sell] = tradeEnd + dutchAuctionLength;
        auction.setupAuction(sellAsset, buyAsset, sellAmount);
    }

    /// A dutch auction can be ongoing in two ways:
    ///   - virtually (tradeEnd is in the past by dutchAuctionLength); or
    ///   - concretely (tradeEnd is in future by dutchAuctionLength)
    /// @return If a dutch auction is ongoing for the sell token
    function dutchAuctionOngoing(IERC20 sell) private view returns (bool) {
        // A dutch auction is ongoing iff tradeEnds[sell] is within dutchAuctionLength in either direction
        //   - if it's earlier, then the auction is virtual
        //   - if it's later, then the auction exists in storage already
        return
            tradeEnds[sell] < block.timestamp + dutchAuctionLength &&
            tradeEnds[sell] + dutchAuctionLength > block.timestamp;
    }
}
