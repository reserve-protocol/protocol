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
        if (tradeEnd + dutchAuctionLength <= block.timestamp) {
            tradeEnd = uint48(block.timestamp - 1); // this allows first bid to happen this block
        }
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
    ) external notTradingPausedOrFrozen returns (Swap memory) {
        // == Refresh ==
        assetRegistry.refresh();
        // should melt() here too; TODO when we add to manageToken()
        return executeSwap(ensureDutchAuctionExists(tokenOut), tokenIn, tokenOut, amountOut);
    }

    /// To be used via callstatic
    /// Should be idempotent if accidentally called
    /// @dev Can be iterated over by a Facade using the assetRegistry.erc20s()
    /// @return The auction as a single Swap
    /// @custom:static-call
    function dutchAuction(IERC20 tokenOut) external notTradingPausedOrFrozen returns (Swap memory) {
        return getAuctionSwap(ensureDutchAuctionExists(tokenOut));
    }

    // === Private ===

    /// Returns a dutch auction from storage or reverts
    /// Post-condition: tradeEnd is > block.timestamp
    function ensureDutchAuctionExists(IERC20 sell) private returns (DutchAuction storage auction) {
        require(address(trades[sell]) == address(0), "nonatomic trade ongoing");
        require(sell != tokenToBuy, "will not sell tokenToBuy");

        auction = dutchAuctions[sell][tradeEnd];
        if (address(auction.sell) != address(0) || address(auction.buy) != address(0)) {
            return auction;
        }

        require(block.timestamp < tradeEnd + dutchAuctionLength, "no dutch auction ongoing");

        tradeEnd += dutchAuctionLength;

        IAsset sellAsset = assetRegistry.toAsset(sell);

        // {sellTok}
        uint192 sellAmount = sellAsset.bal(address(this));
        require(sellAmount > 0, "zero balance");
        dutchAuctions[sell][tradeEnd].setupAuction(
            sellAsset,
            assetRegistry.toAsset(tokenToBuy),
            sellAmount
        );
    }

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[46] private __gap;
}
