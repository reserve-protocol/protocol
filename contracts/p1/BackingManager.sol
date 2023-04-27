// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

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
    uint48 public constant MAX_TRADING_DELAY = 31536000; // {s} 1 year
    uint192 public constant MAX_BACKING_BUFFER = FIX_ONE; // {1} 100%

    uint48 public tradingDelay; // {s} how long to wait until resuming trading after switching
    uint192 public backingBuffer; // {%} how much extra backing collateral to keep

    // === 3.0.0 ===
    IFurnace private furnace;

    // ==== Invariants ====
    // tradingDelay <= MAX_TRADING_DELAY and backingBuffer <= MAX_BACKING_BUFFER
    //
    // ... and the *much* more complicated temporal properties for _manageTokens()

    function init(
        IMain main_,
        uint48 tradingDelay_,
        uint192 backingBuffer_,
        uint192 maxTradeSlippage_,
        uint192 minTradeVolume_
    ) external initializer {
        __Component_init(main_);
        __Trading_init(main_, maxTradeSlippage_, minTradeVolume_);

        assetRegistry = main_.assetRegistry();
        basketHandler = main_.basketHandler();
        distributor = main_.distributor();
        rsr = main_.rsr();
        rsrTrader = main_.rsrTrader();
        rTokenTrader = main_.rTokenTrader();
        rToken = main_.rToken();
        stRSR = main_.stRSR();
        furnace = main_.furnace();

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
        IERC20(address(erc20)).safeApprove(address(main.rToken()), 0);
        IERC20(address(erc20)).safeApprove(address(main.rToken()), type(uint256).max);
    }

    /// Settle a single trade. If DUTCH_AUCTION, try rebalance()
    /// @param sell The sell token in the trade
    /// @return trade The ITrade contract settled
    /// @custom:interaction
    function settleTrade(IERC20 sell) public override(ITrading, TradingP1) returns (ITrade trade) {
        trade = super.settleTrade(sell); // modifier: notTradingPausedOrFrozen

        // if the settler is the trade contract itself, try chaining with another rebalance()
        if (_msgSender() == address(trade)) {
            // solhint-disable-next-line no-empty-blocks
            try this.rebalance(trade.KIND()) {} catch (bytes memory errData) {
                // prevent MEV searchers from providing less gas on purpose by reverting if OOG
                // see: docs/solidity-style.md#Catching-Empty-Data
                if (errData.length == 0) revert(); // solhint-disable-line reason-string
            }
        }
    }

    /// Apply the overall backing policy using the specified TradeKind, taking a haircut if unable
    /// @param kind TradeKind.DUTCH_AUCTION or TradeKind.BATCH_AUCTION
    /// @custom:interaction RCEI
    function rebalance(TradeKind kind) external notTradingPausedOrFrozen {
        // == Refresh ==
        assetRegistry.refresh();
        furnace.melt();

        require(tradesOpen == 0, "trade open");
        require(basketHandler.isReady(), "basket not ready");
        require(block.timestamp >= basketHandler.timestamp() + tradingDelay, "trading delayed");

        BasketRange memory basketsHeld = basketHandler.basketsHeldBy(address(this));
        require(basketsHeld.bottom < rToken.basketsNeeded(), "already collateralized");
        // require(!basketHandler.fullyCollateralized())

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

        (bool doTrade, TradeRequest memory req) = RecollateralizationLibP1
            .prepareRecollateralizationTrade(this, basketsHeld);

        if (doTrade) {
            // Seize RSR if needed
            if (req.sell.erc20() == rsr) {
                uint256 bal = req.sell.erc20().balanceOf(address(this));
                if (req.sellAmount > bal) stRSR.seizeRSR(req.sellAmount - bal);
            }

            tryTrade(kind, req);
        } else {
            // Haircut time
            compromiseBasketsNeeded(basketsHeld.bottom);
        }
    }

    /// Forward revenue to RevenueTraders; reverts if not fully collateralized
    /// @param erc20s The tokens to forward
    /// @custom:interaction RCEI
    function forwardRevenue(IERC20[] calldata erc20s) external notTradingPausedOrFrozen {
        require(ArrayLib.allUnique(erc20s), "duplicate tokens");

        // == Refresh ==
        assetRegistry.refresh();
        furnace.melt();

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

        // Forward any RSR held to StRSR pool; RSR should never be sold for RToken yield
        if (rsr.balanceOf(address(this)) > 0) {
            // For CEI, this is an interaction "within our system" even though RSR is already live
            IERC20(address(rsr)).safeTransfer(address(stRSR), rsr.balanceOf(address(this)));
        }

        // Mint revenue RToken and update `basketsNeeded`
        // across this block:
        //   where rate(R) == R.basketsNeeded / R.totalSupply,
        //   rate(rToken') >== rate(rToken)
        //   (>== is "no less than, and nearly equal to")
        //    and rToken'.basketsNeeded <= basketsHeld.bottom
        // and rToken'.totalSupply is maximal satisfying this.
        uint192 rTokenBuffer; // {rTok}
        uint192 needed = rToken.basketsNeeded(); // {BU}
        if (basketsHeld.bottom.gt(needed)) {
            // gas-optimization: RToken is known to have 18 decimals, the same as FixLib
            uint192 totalSupply = _safeWrap(rToken.totalSupply()); // {rTok}

            // {BU} = {BU} - {BU}
            uint192 extraBUs = basketsHeld.bottom.minus(needed);

            // {rTok} = {BU} * {rTok / BU} (if needed == 0, conv rate is 1 rTok/BU)
            uint192 rTok = (needed > 0) ? extraBUs.mulDiv(totalSupply, needed) : extraBUs;

            // gas-optimization: RToken is known to have 18 decimals, same as FixLib
            rToken.mint(address(this), uint256(rTok));
            rToken.setBasketsNeeded(basketsHeld.bottom);
            needed = basketsHeld.bottom;

            // {rTok} = {1} * ({rTok} + {rTok})
            rTokenBuffer = backingBuffer.mul(totalSupply + rTok);
        }

        // At this point, even though basketsNeeded may have changed:
        // - We're fully collateralized
        // - The BU exchange rate {BU/rTok} did not decrease

        // Keep a small buffer of individual collateral; "excess" assets are beyond the buffer.
        needed = needed.mul(FIX_ONE.plus(backingBuffer));

        // Calculate all balances above the backingBuffer:
        //  - rToken balances above the rTokenBuffer
        //  - non-RToken balances above the backingBuffer
        uint256 length = erc20s.length;
        RevenueTotals memory totals = distributor.totals();
        uint256[] memory toRSR = new uint256[](length);
        uint256[] memory toRToken = new uint256[](length);
        for (uint256 i = 0; i < length; ++i) {
            IAsset asset = assetRegistry.toAsset(erc20s[i]);

            // {tok} = {BU} * {tok/BU}
            uint192 req = erc20s[i] != IERC20(address(rToken))
                ? needed.mul(basketHandler.quantity(erc20s[i]), CEIL)
                : rTokenBuffer;

            uint192 bal = asset.bal(address(this));
            if (bal.gt(req)) {
                // delta: {qTok}, the excess quantity of this asset that we hold
                uint256 delta = bal.minus(req).shiftl_toUint(
                    int8(IERC20Metadata(address(erc20s[i])).decimals())
                );
                // no div-by-0: Distributor guarantees (totals.rTokenTotal + totals.rsrTotal) > 0
                // initial division is intentional here! We'd rather save the dust than be unfair
                toRSR[i] = (delta / (totals.rTokenTotal + totals.rsrTotal)) * totals.rsrTotal;
                toRToken[i] = (delta / (totals.rTokenTotal + totals.rsrTotal)) * totals.rTokenTotal;
            }
        }

        // == Interactions ==
        for (uint256 i = 0; i < length; ++i) {
            if (erc20s[i] == IERC20(address(rToken))) continue;
            IERC20 erc20 = IERC20(address(erc20s[i]));
            if (toRToken[i] > 0) {
                erc20.safeTransfer(address(rTokenTrader), toRToken[i]);
                // solhint-disable-next-line no-empty-blocks
                try rTokenTrader.manageToken(erc20s[i], TradeKind.DUTCH_AUCTION) {} catch {}
                // no need to revert during OOG because caller is already altruistic
            }
            if (toRSR[i] > 0) {
                erc20.safeTransfer(address(rsrTrader), toRSR[i]);
                // solhint-disable-next-line no-empty-blocks
                try rsrTrader.manageToken(erc20s[i], TradeKind.DUTCH_AUCTION) {} catch {}
                // no need to revert during OOG because caller is already altruistic
            }
        }

        // It's okay if there is leftover dust for RToken or a surplus asset (not RSR)
    }

    /// Compromise on how many baskets are needed in order to recollateralize-by-accounting
    /// @param basketsHeldBottom {BU} The number of full basket units held by the BackingManager
    function compromiseBasketsNeeded(uint192 basketsHeldBottom) private {
        // assert(tradesOpen == 0 && !basketHandler.fullyCollateralized());
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
    function cacheFurnace() public {
        furnace = main.furnace();
    }

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[41] private __gap;
}
