// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IMain.sol";
import "../interfaces/IAssetRegistry.sol";
import "./mixins/Trading.sol";
import "./mixins/TradeLib.sol";

/// Trader Component that converts all asset balances at its address to a
/// single target asset and distributes this asset through the Distributor.
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
    IERC20 private rsr;

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
        rsr = main.rsr();
    }

    /// Settle a single trade + distribute revenue
    /// @param sell The sell token in the trade
    /// @return trade The ITrade contract settled
    /// @custom:interaction
    function settleTrade(IERC20 sell) public override(ITrading, TradingP1) returns (ITrade trade) {
        trade = super.settleTrade(sell); // nonReentrant

        // solhint-disable-next-line no-empty-blocks
        try this.distributeTokenToBuy() {} catch (bytes memory errData) {
            // untested:
            //     OOG pattern tested in other contracts, cost to test here is high
            // see: docs/solidity-style.md#Catching-Empty-Data
            if (errData.length == 0) revert(); // solhint-disable-line reason-string
        }
        // unlike BackingManager, do _not_ chain trades; b2b trades of the same token are unlikely
    }

    /// Distribute tokenToBuy to its destinations
    /// @dev Special-case of manageTokens([tokenToBuy], *)
    /// @custom:interaction
    function distributeTokenToBuy() external notTradingPausedOrFrozen {
        _distributeTokenToBuy();
    }

    /// Return registered ERC20s to the BackingManager if distribution for tokenToBuy is 0
    /// @custom:interaction
    function returnTokens(IERC20[] memory erc20s) external notTradingPausedOrFrozen {
        RevenueTotals memory revTotals = distributor.totals();
        if (tokenToBuy == rsr) {
            require(revTotals.rsrTotal == 0, "rsrTotal > 0");
        } else if (address(tokenToBuy) == address(rToken)) {
            require(revTotals.rTokenTotal == 0, "rTokenTotal > 0");
        } else {
            // untestable: tokenToBuy is always the RSR or RToken
            revert("invalid tokenToBuy");
        }

        // Return ERC20s to the BackingManager
        uint256 len = erc20s.length;
        for (uint256 i = 0; i < len; ++i) {
            require(assetRegistry.isRegistered(erc20s[i]), "unregistered erc20");
            erc20s[i].safeTransfer(address(backingManager), erc20s[i].balanceOf(address(this)));
        }
    }

    /// Process some number of tokens
    /// If the tokenToBuy is included in erc20s, RevenueTrader will distribute it at end of the tx
    /// @param erc20s The ERC20s to manage; can be tokenToBuy or anything registered
    /// @param kinds The kinds of auctions to launch: DUTCH_AUCTION | BATCH_AUCTION
    /// @custom:interaction not strictly RCEI; nonReentrant
    // let bal = this contract's balance of erc20
    // checks: !paused (trading), !frozen
    // does nothing if erc20 == addr(0) or bal == 0
    //
    // For each ERC20:
    //   if erc20 is tokenToBuy: distribute it
    //   else: sell erc20 for tokenToBuy
    // untested:
    //      OZ nonReentrant line is assumed to be working. cost/benefit of direct testing is high
    function manageTokens(IERC20[] calldata erc20s, TradeKind[] calldata kinds)
        external
        nonReentrant
        notTradingPausedOrFrozen
    {
        uint256 len = erc20s.length;
        require(len != 0, "empty erc20s list");
        require(len == kinds.length, "length mismatch");
        RevenueTotals memory revTotals = distributor.totals();
        require(
            (tokenToBuy == rsr && revTotals.rsrTotal != 0) ||
                (address(tokenToBuy) == address(rToken) && revTotals.rTokenTotal != 0),
            "zero distribution"
        );

        // Calculate if the trade involves any RToken
        // Distribute tokenToBuy if supplied in ERC20s list
        bool involvesRToken = tokenToBuy == IERC20(address(rToken));
        for (uint256 i = 0; i < len; ++i) {
            if (erc20s[i] == IERC20(address(rToken))) involvesRToken = true;
            if (erc20s[i] == tokenToBuy) {
                _distributeTokenToBuy();
                if (len == 1) return; // return early if tokenToBuy is only entry
            }
        }

        // Cache assetToBuy
        IAsset assetToBuy = assetRegistry.toAsset(tokenToBuy);

        // Refresh everything if RToken is involved
        if (involvesRToken) assetRegistry.refresh();
        else {
            // Otherwise: refresh just the needed assets and nothing more
            for (uint256 i = 0; i < len; ++i) {
                assetRegistry.toAsset(erc20s[i]).refresh();
            }
            assetToBuy.refresh(); // invariant: can never be the RTokenAsset
        }

        // Cache and validate buyHigh
        (uint192 buyLow, uint192 buyHigh) = assetToBuy.price(); // {UoA/tok}
        require(buyHigh != 0 && buyHigh != FIX_MAX, "buy asset price unknown");

        // For each ERC20 that isn't the tokenToBuy, start an auction of the given kind
        for (uint256 i = 0; i < len; ++i) {
            IERC20 erc20 = erc20s[i];
            if (erc20 == tokenToBuy) continue;

            require(address(trades[erc20]) == address(0), "trade open");
            require(erc20.balanceOf(address(this)) != 0, "0 balance");

            IAsset assetToSell = assetRegistry.toAsset(erc20);
            (uint192 sellLow, uint192 sellHigh) = assetToSell.price(); // {UoA/tok}

            TradeInfo memory trade = TradeInfo({
                sell: assetToSell,
                buy: assetToBuy,
                sellAmount: assetToSell.bal(address(this)),
                buyAmount: 0,
                prices: TradePrices(sellLow, sellHigh, buyLow, buyHigh)
            });

            // Whether dust or not, trade the non-target asset for the target asset
            // Any asset with a broken price feed will trigger a revert here
            (, TradeRequest memory req) = TradeLib.prepareTradeSell(
                trade,
                minTradeVolume,
                maxTradeSlippage
            );
            require(req.sellAmount > 1, "sell amount too low");

            // Launch trade
            tryTrade(kinds[i], req, trade.prices);
        }
    }

    // === Internal ===

    /// Distribute tokenToBuy to its destinations
    /// @dev Assumes notTradingPausedOrFrozen has already been checked!
    function _distributeTokenToBuy() internal {
        uint256 bal = tokenToBuy.balanceOf(address(this));
        tokenToBuy.safeApprove(address(distributor), 0);
        tokenToBuy.safeApprove(address(distributor), bal);

        // do not need to use AllowanceLib.safeApproveFallbackToCustom here because
        // tokenToBuy can be assumed to be either RSR or the RToken
        distributor.distribute(tokenToBuy, bal);
    }

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[43] private __gap;
}
