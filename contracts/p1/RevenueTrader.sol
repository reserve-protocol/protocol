// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IAssetRegistry.sol";
import "../interfaces/IMain.sol";
import "../libraries/DutchAuctionLib.sol";
import "./mixins/Trading.sol";
import "./mixins/TradeLib.sol";

/// Trader Component that converts all asset balances at its address to a
/// single target asset and sends this asset to the Distributor.
/// @custom:oz-upgrades-unsafe-allow external-library-linking
contract RevenueTraderP1 is TradingP1, IRevenueTrader {
    using DutchAuctionLib for DutchAuction;
    using FixLib for uint192;
    using SafeERC20Upgradeable for IERC20Upgradeable;

    // Immutable after init()
    IERC20 public tokenToBuy;
    IAssetRegistry private assetRegistry;
    IDistributor private distributor;

    // === Added in 3.0.0 ===

    // inner keys: dutch auction end times {s}
    // outer keys: sell token
    mapping(IERC20 => mapping(uint48 => DutchAuction)) private dutchAuctions;

    function init(
        IMain main_,
        IERC20 tokenToBuy_,
        uint192 maxTradeSlippage_,
        uint192 minTradeVolume_,
        uint48 dutchAuctionLength_
    ) external initializer {
        require(address(tokenToBuy_) != address(0), "invalid token address");
        __Component_init(main_);
        __Trading_init(main_, maxTradeSlippage_, minTradeVolume_, dutchAuctionLength_);
        assetRegistry = main_.assetRegistry();
        distributor = main_.distributor();
        tokenToBuy = tokenToBuy_;
    }

    /// Starts dutch auctions from the current block, unless they are already ongoing
    /// Callable only by BackingManager
    /// @custom:refresher
    function processRevenue() public {
        require(_msgSender() == address(main.backingManager()), "backing manager only");
        if (tradeEnd <= block.timestamp) tradeEnd = uint48(block.timestamp) + dutchAuctionLength;
    }

    /// If erc20 is tokenToBuy, distribute it; else, sell it for tokenToBuy
    /// @dev Intended to be used with multicall
    /// @custom:interaction CEI
    // let bal = this contract's balance of erc20
    // checks: !paused (trading), !frozen
    // does nothing if erc20 == addr(0) or bal == 0
    //
    // If erc20 is tokenToBuy:
    //   actions:
    //     erc20.increaseAllowance(distributor, bal) - two safeApprove calls to support USDT
    //     distributor.distribute(erc20, this, bal)
    //
    // If erc20 is any other registered asset (checked):
    //   actions:
    //     openTrade(prepareTradeSell(toAsset(erc20), toAsset(tokenToBuy), bal))
    //     (i.e, start a trade, selling as much of our bal of erc20 as we can, to buy tokenToBuy)
    function manageToken(IERC20 erc20) external notTradingPausedOrFrozen {
        require(address(trades[erc20]) == address(0), "trade open");

        // == Refresh ==
        assetRegistry.refresh();
        // TODO melt

        uint256 bal = erc20.balanceOf(address(this));
        require(bal > 0, "zero balance");

        if (erc20 == tokenToBuy) {
            // == Interactions then return ==
            IERC20Upgradeable(address(erc20)).safeApprove(address(distributor), 0);
            IERC20Upgradeable(address(erc20)).safeApprove(address(distributor), bal);
            distributor.distribute(erc20, bal);
            return;
        }

        require(!inDutchAuctionWindow(), "dutch auction ongoing");

        IAsset sell = assetRegistry.toAsset(erc20);
        IAsset buy = assetRegistry.toAsset(tokenToBuy);
        (uint192 sellPrice, ) = sell.price(); // {UoA/tok}
        (, uint192 buyPrice) = buy.price(); // {UoA/tok}

        require(buyPrice > 0 && buyPrice < FIX_MAX, "buy asset price unknown");

        TradeInfo memory trade = TradeInfo({
            sell: sell,
            buy: buy,
            sellAmount: sell.bal(address(this)),
            buyAmount: 0,
            sellPrice: sellPrice,
            buyPrice: buyPrice
        });

        // If not dust, trade the non-target asset for the target asset
        // Any asset with a broken price feed will trigger a revert here
        (bool launch, TradeRequest memory req) = TradeLib.prepareTradeSell(
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
        assetRegistry.refresh();
        // should melt() here too; TODO when we add to manageToken()

        // === Checks + Effects ===

        DutchAuction storage auction = ensureDutchAuctionIsSetup(tokenOut);
        // after: tradeEnd > block.timestamp

        require(auction.buy.erc20() == tokenIn, "buy token mismatch");
        require(auction.sell.erc20() == tokenOut, "sell token mismatch");
        require(tokenOut != tokenToBuy, "will not sell tokenToBuy");

        // {buyTok}
        uint192 bidBuyAmt = shiftl_toFix(amountOut, -int8(auction.buy.erc20Decimals()));

        // === Interactions ===

        // Complete bid + swap
        return auction.bid(divuu(block.timestamp - tradeEnd, dutchAuctionLength), bidBuyAmt);
    }

    /// To be used via callstatic
    /// Should be idempotent if accidentally called
    /// @dev Can be iterated over by a Facade using the assetRegistry.erc20s()
    /// @custom:static-call
    function getSwap(IERC20 tokenOut) external returns (Swap memory s) {
        // == Refresh ==
        assetRegistry.refresh();
        // should melt() here too; TODO when we add to manageToken()

        // === Checks + Effects ===

        uint48 tradeEnd = tradeEnd;
        DutchAuction storage auction = ensureDutchAuctionIsSetup(tokenOut);
        // after: tradeEnd > block.timestamp

        // {buyTok/sellTok}
        uint192 price = DutchAuctionLib.currentPrice(
            divuu(block.timestamp + dutchAuctionLength - tradeEnd, dutchAuctionLength),
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

    /// Returns a dutch auction from storage or reverts
    /// Post-condition: endTrade is > block.timestamp
    function ensureDutchAuctionIsSetup(IERC20 sell) private returns (DutchAuction storage auction) {
        require(inDutchAuctionWindow(), "no dutch auction ongoing");

        auction = dutchAuctions[sell][tradeEnd];
        if (address(auction.sell) != address(0) || address(auction.buy) != address(0)) {
            return auction;
        }
        // else: virtual ongoing auction; ie tradeEnd <= block.timestamp by dutchAuctionLength

        IAsset sellAsset = assetRegistry.toAsset(sell);

        // {sellTok}
        uint192 sellAmount = sellAsset.bal(address(this));

        // at this point: the auction is virtual, make it real and advance the tradeEnd
        if (tradeEnd <= block.timestamp) tradeEnd += dutchAuctionLength;
        auction = dutchAuctions[sell][tradeEnd];
        auction.setupAuction(sellAsset, assetRegistry.toAsset(tokenToBuy), sellAmount);
    }

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[46] private __gap;
}
