// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IAsset.sol";
import "../interfaces/IBackingManager.sol";
import "../interfaces/IMain.sol";
import "../libraries/Array.sol";
import "../libraries/Fixed.sol";
import "./mixins/Trading.sol";
import "./mixins/RecollateralizationLib.sol";

/**
 * @title BackingManager
 * @notice The backing manager holds + manages the backing for an RToken
 */

/// @custom:oz-upgrades-unsafe-allow external-library-linking
contract BackingManagerP1 is TradingP1, IBackingManager {
    using FixLib for uint192;
    using SafeERC20 for IERC20;

    // Cache of peer components
    IAssetRegistry private assetRegistry;
    IBasketHandler private basketHandler;
    IDistributor private distributor;
    IRToken private rToken;
    IERC20 private rsr;
    IStRSR private stRSR;
    IRevenueTrader private rsrTrader;
    IRevenueTrader private rTokenTrader;
    uint48 public constant MAX_TRADING_DELAY = 60 * 60 * 24 * 365; // {s} 1 year
    uint192 public constant MAX_BACKING_BUFFER = FIX_ONE; // {1} 100%

    uint48 public tradingDelay; // {s} how long to wait until resuming trading after switching
    uint192 public backingBuffer; // {1} how much extra backing collateral to keep

    // === 3.0.0 ===
    IFurnace private furnace;
    mapping(TradeKind => uint48) private tradeEnd; // {s} last endTime() of an auction per kind

    // === 3.1.0 ===
    mapping(IERC20 => uint192) private tokensOut; // {tok} token balances out in ITrades

    // ==== Invariants ====
    // tradingDelay <= MAX_TRADING_DELAY and backingBuffer <= MAX_BACKING_BUFFER

    function init(
        IMain main_,
        uint48 tradingDelay_,
        uint192 backingBuffer_,
        uint192 maxTradeSlippage_,
        uint192 minTradeVolume_
    ) external initializer {
        __Component_init(main_);
        __Trading_init(main_, maxTradeSlippage_, minTradeVolume_);

        cacheComponents();
        setTradingDelay(tradingDelay_);
        setBackingBuffer(backingBuffer_);
    }

    /// Give RToken max allowance over the registered token `erc20`
    /// @custom:interaction CEI
    // checks: erc20 in assetRegistry
    // action: set allowance on erc20 for rToken to UINT_MAX
    // Using two safeApprove calls instead of safeIncreaseAllowance to support USDT
    function grantRTokenAllowance(IERC20 erc20) external notFrozen {
        require(assetRegistry.isRegistered(erc20), "erc20 unregistered");
        // == Interaction ==
        IERC20(address(erc20)).safeApprove(address(rToken), 0);
        IERC20(address(erc20)).safeApprove(address(rToken), type(uint256).max);
    }

    /// Settle a single trade. If the caller is the trade, try chaining into rebalance()
    /// While this function is not nonReentrant, its two subsets each individually are
    /// If the caller is a trade contract, initiate the next trade.
    /// This is done in order to better align incentives,
    /// and have the last bidder be the one to start the next auction.
    /// This behaviour currently only happens for Dutch Trade.
    /// @param sell The sell token in the trade
    /// @return trade The ITrade contract settled
    /// @custom:interaction
    function settleTrade(IERC20 sell) public override(ITrading, TradingP1) returns (ITrade trade) {
        delete tokensOut[sell];
        trade = super.settleTrade(sell); // nonReentrant

        // if the settler is the trade contract itself, try chaining with another rebalance()
        if (_msgSender() == address(trade)) {
            // solhint-disable-next-line no-empty-blocks
            try this.rebalance(trade.KIND()) {} catch (bytes memory errData) {
                // prevent MEV searchers from providing less gas on purpose by reverting if OOG
                // untested:
                //     OOG pattern tested in other contracts, cost to test here is high
                // see: docs/solidity-style.md#Catching-Empty-Data
                if (errData.length == 0) revert(); // solhint-disable-line reason-string
            }
        }
    }

    /// Apply the overall backing policy using the specified TradeKind, taking a haircut if unable
    /// @param kind TradeKind.DUTCH_AUCTION or TradeKind.BATCH_AUCTION
    /// @custom:interaction not RCEI; nonReentrant
    // untested:
    //      OZ nonReentrant line is assumed to be working. cost/benefit of direct testing is high
    function rebalance(TradeKind kind) external nonReentrant {
        requireNotTradingPausedOrFrozen();

        // == Refresh ==
        assetRegistry.refresh();

        // DoS prevention:
        // unless caller is self, require that the next auction is not in same block
        require(
            _msgSender() == address(this) || tradeEnd[kind] < block.timestamp,
            "already rebalancing"
        );

        require(tradesOpen == 0, "trade open");
        require(basketHandler.isReady(), "basket not ready");
        require(block.timestamp >= basketHandler.timestamp() + tradingDelay, "trading delayed");

        BasketRange memory basketsHeld = basketHandler.basketsHeldBy(address(this));
        require(basketsHeld.bottom < rToken.basketsNeeded(), "already collateralized");
        // require(!basketHandler.fullyCollateralized())

        // First dissolve any held RToken balance (above Distributor-dust)
        // gas-optimization: 1 whole RToken must be worth 100 trillion dollars for this to skip $1
        uint256 balance = rToken.balanceOf(address(this));
        if (balance >= MAX_DISTRIBUTION * MAX_DESTINATIONS) rToken.dissolve(balance);
        if (basketsHeld.bottom >= rToken.basketsNeeded()) return; // return if now capitalized

        /*
         * Recollateralization
         *
         * Strategy: iteratively move the system on a forgiving path towards collateralization
         * through a narrowing BU price band. The initial large spread reflects the
         * uncertainty associated with the market price of defaulted/volatile collateral, as
         * well as potential losses due to trading slippage. In the absence of further
         * collateral default, the size of the BU price band should decrease with each trade
         * until it is 0, at which point collateralization is restored.
         *
         * If we run out of capital and are still undercollateralized, we compromise
         * rToken.basketsNeeded to the current basket holdings. Haircut time.
         */

        (TradingContext memory ctx, Registry memory reg) = tradingContext(basketsHeld);
        (
            bool doTrade,
            TradeRequest memory req,
            TradePrices memory prices
        ) = RecollateralizationLibP1.prepareRecollateralizationTrade(ctx, reg);

        if (doTrade) {
            IERC20 sellERC20 = req.sell.erc20();

            // Seize RSR if needed
            if (sellERC20 == rsr) {
                uint256 bal = sellERC20.balanceOf(address(this));
                if (req.sellAmount > bal) stRSR.seizeRSR(req.sellAmount - bal);
            }

            // Execute Trade
            ITrade trade = tryTrade(kind, req, prices);
            tradeEnd[kind] = trade.endTime(); // {s}
            tokensOut[sellERC20] = trade.sellAmount(); // {tok}
        } else {
            // Haircut time
            compromiseBasketsNeeded(basketsHeld.bottom);
        }
    }

    /// Forward revenue to RevenueTraders; reverts if not fully collateralized
    /// @param erc20s The tokens to forward
    /// @custom:interaction not RCEI; nonReentrant
    // untested:
    //      OZ nonReentrant line is assumed to be working. cost/benefit of direct testing is high
    function forwardRevenue(IERC20[] calldata erc20s) external nonReentrant {
        requireNotTradingPausedOrFrozen();
        require(ArrayLib.allUnique(erc20s), "duplicate tokens");

        assetRegistry.refresh();

        BasketRange memory basketsHeld = basketHandler.basketsHeldBy(address(this));

        require(tradesOpen == 0, "trade open");
        require(basketHandler.isReady(), "basket not ready");
        require(block.timestamp >= basketHandler.timestamp() + tradingDelay, "trading delayed");
        require(basketsHeld.bottom >= rToken.basketsNeeded(), "undercollateralized");
        // require(basketHandler.fullyCollateralized())

        /**
         * Assumptions:
         *   - Fully collateralized. All collateral meet balance requirements.
         *   - All backing capital is held at BackingManager's address. No capital is out on-trade
         *   - Neither RToken nor RSR are in the basket
         *   - Each address in erc20s is unique
         *
         * Steps:
         *   1. Forward all held RSR to the RSR trader to prevent using it for RToken appreciation
         *      (action: send rsr().balanceOf(this) to rsrTrader)
         *   2. Using whatever balances of collateral are there, fast-issue all RToken possible.
         *      (in detail: mint RToken and set basketsNeeded so that the BU/rtok exchange rate is
         *       roughly constant, and strictly does not decrease,
         *   3. Handout all RToken held above the backingBuffer portion of the supply, and all
         *      non-RToken surplus asset balances to the RSR and
         *      RToken traders according to the distribution totals.
         */

        // Forward any RSR held to StRSR pool and payout rewards
        // RSR should never be sold for RToken yield
        if (rsr.balanceOf(address(this)) != 0) {
            // For CEI, this is an interaction "within our system" even though RSR is already live
            IERC20(address(rsr)).safeTransfer(address(stRSR), rsr.balanceOf(address(this)));
            stRSR.payoutRewards();
        }

        // Mint revenue RToken
        // Keep backingBuffer worth of collateral before recognizing revenue
        uint192 baskets = (basketsHeld.bottom.div(FIX_ONE + backingBuffer));
        if (baskets > rToken.basketsNeeded()) {
            rToken.mint(baskets - rToken.basketsNeeded());
        }

        uint192 needed = rToken.basketsNeeded().mul(FIX_ONE + backingBuffer); // {BU}

        // At this point, even though basketsNeeded may have changed, we are:
        // - We're fully collateralized
        // - The BU exchange rate {BU/rTok} did not decrease

        // Handout surplus assets + newly minted RToken

        uint256 length = erc20s.length;
        RevenueTotals memory totals = distributor.totals();
        for (uint256 i = 0; i < length; ++i) {
            IAsset asset = assetRegistry.toAsset(erc20s[i]);

            // Use same quantity-rounding as BasketHandler.basketsHeldBy()
            // {tok} = {BU} * {tok/BU}
            uint192 req = needed.mul(basketHandler.quantity(erc20s[i]), CEIL);
            uint192 bal = asset.bal(address(this));

            if (bal.gt(req)) {
                // delta: {qTok}, the excess quantity of this asset that we hold
                uint256 delta = bal.minus(req).shiftl_toUint(int8(asset.erc20Decimals()));
                uint256 tokensPerShare = delta / (totals.rTokenTotal + totals.rsrTotal);
                if (tokensPerShare == 0) continue;

                // no div-by-0: Distributor guarantees (totals.rTokenTotal + totals.rsrTotal) > 0
                // initial division is intentional here! We'd rather save the dust than be unfair

                if (totals.rsrTotal != 0) {
                    erc20s[i].safeTransfer(address(rsrTrader), tokensPerShare * totals.rsrTotal);
                }
                if (totals.rTokenTotal != 0) {
                    erc20s[i].safeTransfer(
                        address(rTokenTrader),
                        tokensPerShare * totals.rTokenTotal
                    );
                }
            }
        }
        // It's okay if there is leftover dust for RToken or a surplus asset (not RSR)
    }

    // === View ===

    /// Structs for trading
    /// @param basketsHeld The number of baskets held by the BackingManager
    /// @return ctx The TradingContext
    /// @return reg Contents of AssetRegistry.getRegistry()
    function tradingContext(BasketRange memory basketsHeld)
        public
        view
        returns (TradingContext memory ctx, Registry memory reg)
    {
        reg = assetRegistry.getRegistry();

        ctx.basketsHeld = basketsHeld;
        ctx.bh = basketHandler;
        ctx.ar = assetRegistry;
        ctx.stRSR = stRSR;
        ctx.rsr = rsr;
        ctx.rToken = rToken;
        ctx.minTradeVolume = minTradeVolume;
        ctx.maxTradeSlippage = maxTradeSlippage;
        ctx.quantities = new uint192[](reg.erc20s.length);
        for (uint256 i = 0; i < reg.erc20s.length; ++i) {
            ctx.quantities[i] = basketHandler.quantityUnsafe(reg.erc20s[i], reg.assets[i]);
            // quantities round up, without any issuance premium
        }
        ctx.bals = new uint192[](reg.erc20s.length);
        for (uint256 i = 0; i < reg.erc20s.length; ++i) {
            ctx.bals[i] = reg.assets[i].bal(address(this)) + tokensOut[reg.erc20s[i]];

            // include StRSR's balance for RSR
            if (reg.erc20s[i] == rsr) ctx.bals[i] += reg.assets[i].bal(address(stRSR));
        }
    }

    // === Private ===

    /// Compromise on how many baskets are needed in order to recollateralize-by-accounting
    /// @param basketsHeldBottom {BU} The number of full basket units held by the BackingManager
    function compromiseBasketsNeeded(uint192 basketsHeldBottom) private {
        // assert(tradesOpen == 0 && !basketHandler.fullyCollateralized());
        assert(tradesOpen == 0);
        rToken.setBasketsNeeded(basketsHeldBottom);
    }

    // === Governance Setters ===

    /// @custom:governance
    function setTradingDelay(uint48 val) public governance {
        require(val <= MAX_TRADING_DELAY, "invalid tradingDelay");
        emit TradingDelaySet(tradingDelay, val);
        tradingDelay = val;
    }

    /// @custom:governance
    function setBackingBuffer(uint192 val) public governance {
        require(val <= MAX_BACKING_BUFFER, "invalid backingBuffer");
        emit BackingBufferSet(backingBuffer, val);
        backingBuffer = val;
    }

    /// Call after upgrade to >= 3.0.0
    function cacheComponents() public {
        assetRegistry = main.assetRegistry();
        basketHandler = main.basketHandler();
        distributor = main.distributor();
        rToken = main.rToken();
        rsr = main.rsr();
        stRSR = main.stRSR();
        rsrTrader = main.rsrTrader();
        rTokenTrader = main.rTokenTrader();
        furnace = main.furnace();
    }

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[38] private __gap;
}
