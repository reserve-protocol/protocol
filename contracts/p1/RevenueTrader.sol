// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
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
    using SafeERC20 for IERC20;

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
    function refreshAuctions() external {
        require(_msgSender() == address(main.backingManager()), "backing manager only");

        // safely reset tradeEnd
        if (tradeEnd + dutchAuctionLength <= block.timestamp) {
            tradeEnd = uint48(block.timestamp); // allows first bid to happen this block
        }
    }

    /// Settle a single trade
    function settleTrade(IERC20 sell) public override(ITrading, TradingP1) {
        super.settleTrade(sell);
        distributeTokenToBuy(tokenToBuy.balanceOf(address(this)));
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
        furnace.melt();

        uint256 bal = erc20.balanceOf(address(this));
        require(bal > 0, "zero balance");

        if (erc20 == tokenToBuy) {
            distributeTokenToBuy(bal);
            return;
        }

        require(tradeEnd + dutchAuctionLength <= block.timestamp, "dutch auction ongoing");

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
        assetRegistry.refresh();
        furnace.melt();

        require(address(trades[tokenOut]) == address(0), "nonatomic trade ongoing");
        require(tokenIn == tokenToBuy, "will only buy tokenToBuy");
        require(tokenOut != tokenToBuy, "will not sell tokenToBuy");

        // executeSwap if storage auction already exists
        DutchAuction storage auction = dutchAuctions[tokenOut][tradeEnd];
        if (
            tradeEnd > block.timestamp &&
            (address(auction.sell) != address(0) || address(auction.buy) != address(0))
        ) {
            return executeSwap(auction, amountOut);
        }

        // === Checks/Effects ===

        require(
            tradeEnd + dutchAuctionLength > block.timestamp &&
                block.timestamp + dutchAuctionLength > tradeEnd,
            "no dutch auction ongoing"
        );

        // bump tradeEnd if it is in the past
        if (tradeEnd <= block.timestamp) tradeEnd += dutchAuctionLength;

        IAsset sellAsset = assetRegistry.toAsset(tokenOut);

        dutchAuctions[tokenOut][tradeEnd] = DutchAuctionLib.makeAuction(
            sellAsset,
            assetRegistry.toAsset(tokenToBuy),
            sellAsset.bal(address(this)),
            minTradeVolume,
            maxTradeSlippage
        );

        uint256 balBeforeSwap = tokenToBuy.balanceOf(address(this)); // {qSellTok}

        // === Interactions ===
        s = executeSwap(dutchAuctions[tokenOut][tradeEnd], amountOut);
        distributeTokenToBuy(balBeforeSwap + s.buyAmount);
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
        if (
            // endTrade may be in the future without a storage auction because of another token
            tradeEnd > block.timestamp &&
            (address(auction.sell) != address(0) || address(auction.buy) != address(0))
        ) {
            return auction.toSwap(progression());
        }

        require(
            tradeEnd + dutchAuctionLength > block.timestamp &&
                block.timestamp + dutchAuctionLength > tradeEnd,
            "no dutch auction ongoing"
        );
        IAsset sellAsset = assetRegistry.toAsset(tokenOut);

        // {sellTok}
        uint192 sellAmount = sellAsset.bal(address(this));
        require(sellAmount > 0, "zero balance");
        return
            DutchAuctionLib
                .makeAuction(
                    sellAsset,
                    main.assetRegistry().toAsset(tokenToBuy),
                    sellAmount,
                    minTradeVolume,
                    maxTradeSlippage
                )
                .toSwap(progression() - (tradeEnd > block.timestamp ? 0 : FIX_ONE));
    }

    // === Private ===

    /// Forward an amount of tokenToBuy through the distributor
    function distributeTokenToBuy(uint256 amount) private {
        tokenToBuy.safeApprove(address(distributor), 0);
        tokenToBuy.safeApprove(address(distributor), amount);
        distributor.distribute(tokenToBuy, amount);
    }

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[46] private __gap;
}
