// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IMain.sol";
import "../interfaces/IAssetRegistry.sol";
import "./mixins/Trading.sol";
import "./mixins/TradeLib.sol";

/// Trader Component that converts all asset balances at its address to a
/// single target asset and sends this asset to the Distributor.
/// @custom:oz-upgrades-unsafe-allow external-library-linking
contract RevenueTraderP1 is TradingP1, IRevenueTrader {
    using FixLib for uint192;
    using SafeERC20 for IERC20;

    // Immutable after init()
    IERC20 public tokenToBuy;
    IAssetRegistry private assetRegistry;
    IDistributor private distributor;
    IBackingManager private backingManager;
    IFurnace private furnace;
    IRToken private rToken;

    function init(
        IMain main_,
        IERC20 tokenToBuy_,
        uint192 maxTradeSlippage_,
        uint192 minTradeVolume_
    ) external initializer {
        require(address(tokenToBuy_) != address(0), "invalid token address");
        __Component_init(main_);
        __Trading_init(main_, maxTradeSlippage_, minTradeVolume_);
        tokenToBuy = tokenToBuy_;
        cacheComponents();
    }

    /// Call after upgrade to >= 3.0.0
    function cacheComponents() public {
        assetRegistry = main.assetRegistry();
        distributor = main.distributor();
        backingManager = main.backingManager();
        furnace = main.furnace();
        rToken = main.rToken();
    }

    /// Settle a single trade + distribute revenue
    /// @param sell The sell token in the trade
    /// @return trade The ITrade contract settled
    /// @custom:interaction
    function settleTrade(IERC20 sell)
        public
        override(ITrading, TradingP1)
        notTradingPausedOrFrozen
        returns (ITrade trade)
    {
        trade = super.settleTrade(sell); // nonReentrant
        _distributeTokenToBuy();
        // unlike BackingManager, do _not_ chain trades; b2b trades of the same token are unlikely
    }

    /// Distribute tokenToBuy to its destinations
    /// @dev Special-case of manageToken(tokenToBuy, *)
    /// @custom:interaction
    function distributeTokenToBuy() external notTradingPausedOrFrozen {
        _distributeTokenToBuy();
    }

    /// If erc20 is tokenToBuy, distribute it; else, sell it for tokenToBuy
    /// @dev Intended to be used with multicall
    /// @param kind TradeKind.DUTCH_AUCTION or TradeKind.BATCH_AUCTION
    /// @custom:interaction RCEI and nonReentrant
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
    //     tryTrade(kind, prepareTradeSell(toAsset(erc20), toAsset(tokenToBuy), bal))
    //     (i.e, start a trade, selling as much of our bal of erc20 as we can, to buy tokenToBuy)
    // untested:
    //      OZ nonReentrant line is assumed to be working. cost/benefit of direct testing is high
    function manageToken(IERC20 erc20, TradeKind kind)
        external
        nonReentrant
        notTradingPausedOrFrozen
    {
        if (erc20 == tokenToBuy) {
            _distributeTokenToBuy();
            return;
        }

        // == Refresh ==
        // Skip refresh() if data is from current block
        if (erc20 != IERC20(address(rToken)) && tokenToBuy != IERC20(address(rToken))) {
            IAsset sell_ = assetRegistry.toAsset(erc20);
            IAsset buy_ = assetRegistry.toAsset(tokenToBuy);
            if (sell_.lastSave() != uint48(block.timestamp)) sell_.refresh();
            if (buy_.lastSave() != uint48(block.timestamp)) buy_.refresh();
        } else if (assetRegistry.lastRefresh() != uint48(block.timestamp)) {
            // Refresh everything only if RToken is being traded
            assetRegistry.refresh();
        }

        // == Checks/Effects ==
        // Above calls should not have changed registered assets, but just to be safe...
        IAsset sell = assetRegistry.toAsset(erc20);
        IAsset buy = assetRegistry.toAsset(tokenToBuy);

        require(address(trades[erc20]) == address(0), "trade open");
        require(erc20.balanceOf(address(this)) > 0, "0 balance");

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

        // Whether dust or not, trade the non-target asset for the target asset
        // Any asset with a broken price feed will trigger a revert here
        (, TradeRequest memory req) = TradeLib.prepareTradeSell(
            trade,
            minTradeVolume,
            maxTradeSlippage
        );
        require(req.sellAmount > 1, "sell amount too low");

        // == Interactions ==
        tryTrade(kind, req);
    }

    // === Internal ===

    /// Distribute tokenToBuy to its destinations
    /// @dev Assumes notTradingPausedOrFrozen has already been checked!
    function _distributeTokenToBuy() internal {
        uint256 bal = tokenToBuy.balanceOf(address(this));
        tokenToBuy.safeApprove(address(distributor), 0);
        tokenToBuy.safeApprove(address(distributor), bal);
        distributor.distribute(tokenToBuy, bal);
    }

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[44] private __gap;
}
