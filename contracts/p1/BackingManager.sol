// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IAsset.sol";
import "../interfaces/IBackingManager.sol";
import "../interfaces/IMain.sol";
import "../libraries/Array.sol";
import "../libraries/Fixed.sol";
import "./mixins/SwapLib.sol";
import "./mixins/RecollateralizationLib.sol";
import "./mixins/Trading.sol";

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
    uint192 public constant MAX_TRADE_COOLDOWN = 86400; // {s} 24hr

    uint48 public tradingDelay; // {s} how long to wait until resuming trading after switching
    uint192 public backingBuffer; // {%} how much extra backing collateral to keep
    uint48 public tradeCooldown; // {s} number of seconds between any type of trade
    uint48 public whenNextTrade; // {s} block timestamp at which can next trade

    // TODO check storage slots

    // ==== Invariants ====
    // tradingDelay <= MAX_TRADING_DELAY
    // backingBuffer <= MAX_BACKING_BUFFER
    // tradeCooldown <= MAX_TRADE_COOLDOWN
    // ... and the *much* more complicated temporal properties for _manageTokens()

    function init(
        IMain main_,
        uint48 tradingDelay_,
        uint192 backingBuffer_,
        uint192 maxTradeSlippage_,
        uint192 minTradeVolume_,
        uint192 swapPricepoint_,
        uint48 tradeCooldown_
    ) external initializer {
        __Component_init(main_);
        __Trading_init(main_, maxTradeSlippage_, minTradeVolume_, swapPricepoint_);

        assetRegistry = main_.assetRegistry();
        basketHandler = main_.basketHandler();
        distributor = main_.distributor();
        rsr = main_.rsr();
        rsrTrader = main_.rsrTrader();
        rTokenTrader = main_.rTokenTrader();
        rToken = main_.rToken();
        stRSR = main_.stRSR();

        setTradingDelay(tradingDelay_);
        setBackingBuffer(backingBuffer_);
        setTradeCooldown(tradeCooldown_);
    }

    /// Give RToken max allowance over the registered token `erc20`
    /// @custom:interaction CEI
    // checks: erc20 in assetRegistry
    // action: set allowance on erc20 for rToken to UINT_MAX
    // Using two safeApprove calls instead of safeIncreaseAllowance to support USDT
    function grantRTokenAllowance(IERC20 erc20) external notFrozen {
        require(assetRegistry.isRegistered(erc20), "erc20 unregistered");
        // == Interaction ==
        erc20.safeApprove(address(main.rToken()), 0);
        erc20.safeApprove(address(main.rToken()), type(uint256).max);
    }

    /// Maintain the overall backing policy; handout assets otherwise
    /// @custom:interaction
    // checks: the addresses in `erc20s` are unique
    // effect: _manageTokens(erc20s)
    function manageTokens(IERC20[] calldata erc20s) external notTradingPausedOrFrozen {
        // Token list must not contain duplicates
        require(ArrayLib.allUnique(erc20s), "duplicate tokens");
        _manageTokens(erc20s);
    }

    /// Maintain the overall backing policy; handout assets otherwise
    /// @dev Tokens must be in sorted order!
    /// @dev Performs a uniqueness check on the erc20s list in O(n)
    /// @custom:interaction
    // checks: the addresses in `erc20s` are unique (and sorted)
    // effect: _manageTokens(erc20s)
    function manageTokensSortedOrder(IERC20[] calldata erc20s) external notTradingPausedOrFrozen {
        // Token list must not contain duplicates
        require(ArrayLib.sortedAndAllUnique(erc20s), "duplicate/unsorted tokens");
        _manageTokens(erc20s);
    }

    /// Maintain the overall backing policy; handout assets otherwise
    /// @custom:interaction RCEI
    // only called internally, from manageTokens*, so erc20s has no duplicates unique
    // (but not necessarily all registered or valid!)
    function _manageTokens(IERC20[] calldata erc20s) private {
        // == Refresh ==
        assetRegistry.refresh();

        requireReadyToTrade();

        BasketRange memory basketsHeld = basketHandler.basketsHeldBy(address(this));
        uint192 basketsNeeded = rToken.basketsNeeded(); // {BU}

        // if (basketHandler.fullyCollateralized())
        if (basketsHeld.bottom >= basketsNeeded) {
            // == Interaction (then return) ==
            handoutExcessAssets(erc20s, basketsHeld.bottom);
        } else {
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

                ITrade trade = openTrade(req);
                whenNextTrade = trade.endTime() + tradeCooldown;
            } else {
                // Haircut time
                compromiseBasketsNeeded(basketsHeld.bottom, basketsNeeded);
                whenNextTrade = uint48(block.timestamp) + tradeCooldown;
                // this isn't a trade technically, but seems like it should reset the cooldown too
            }
        }
    }

    /// Maintain the overall backing policy in an atomic swap with the caller
    /// Supports both exactInput and exactOutput swap methods
    /// @dev Caller must have granted tokenIn allowances for up to maxAmountIn
    /// @param tokenIn The input token, the one the caller provides
    /// @param tokenOut The output token, the one the protocol provides
    /// @param minAmountOut {qTokenOut} The minimum amount the swapper wants in output tokens
    /// @param maxAmountIn {qTokenIn} The most the swapper is willing to pay in input tokens
    /// @return s The actual swap performed
    /// @custom:interaction
    function swap(
        IERC20 tokenIn,
        IERC20 tokenOut,
        uint256 maxAmountIn,
        uint256 minAmountOut
    ) external notPausedOrFrozen returns (Swap memory s) {
        // == Refresh ==
        assetRegistry.refresh();

        // Get precise Swap
        s = getSwap();
        whenNextTrade = uint48(block.timestamp) + tradeCooldown;

        // Require the calculated swap is better than the passed-in swap
        require(s.sell == tokenOut && s.buy == tokenIn, "swap tokens changed");
        require(s.sellAmount >= minAmountOut, "output amount fell");
        require(s.buyAmount <= maxAmountIn, "input amount increased");

        // Seize RSR if needed
        if (s.sell == rsr) {
            uint256 bal = s.sell.balanceOf(address(this));
            if (s.sellAmount > bal) stRSR.seizeRSR(s.sellAmount - bal);
        }

        executeSwap(s);
    }

    /// @return The next Swap, without refreshing the assetRegistry
    function getSwap() public view returns (Swap memory) {
        requireReadyToTrade();

        // TradeRequest from manageTokens()
        (bool doTrade, TradeRequest memory req) = RecollateralizationLibP1
            .prepareRecollateralizationTrade(this, basketHandler.basketsHeldBy(address(this)));

        require(doTrade, "swap not available");
        return SwapLib.prepareSwap(req, swapPricepoint, SwapLib.SwapVariant.CALCULATE_SELL_AMOUNT);
    }

    // === Private ===

    /// Send excess assets to the RSR and RToken traders
    /// @param basketsHeldBottom {BU} The number of full basket units held by the BackingManager
    /// @custom:interaction CEI
    function handoutExcessAssets(IERC20[] calldata erc20s, uint192 basketsHeldBottom) private {
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
         *   3. Handout all surplus asset balances (including collateral and RToken) to the
         *      RSR and RToken traders according to the distribution totals.
         */

        // Forward any RSR held to StRSR pool; RSR should never be sold for RToken yield
        if (rsr.balanceOf(address(this)) > 0) {
            // For CEI, this is an interaction "within our system" even though RSR is already live
            rsr.safeTransfer(address(stRSR), rsr.balanceOf(address(this)));
        }

        // Mint revenue RToken and update `basketsNeeded`
        // across this block:
        //   where rate(R) == R.basketsNeeded / R.totalSupply,
        //   rate(rToken') >== rate(rToken)
        //   (>== is "no less than, and nearly equal to")
        //    and rToken'.basketsNeeded <= basketsHeldBottom
        // and rToken'.totalSupply is maximal satisfying this.
        uint192 needed; // {BU}
        {
            needed = rToken.basketsNeeded(); // {BU}
            if (basketsHeldBottom.gt(needed)) {
                // gas-optimization: RToken is known to have 18 decimals, the same as FixLib
                uint192 totalSupply = _safeWrap(rToken.totalSupply()); // {rTok}

                // {BU} = {BU} - {BU}
                uint192 extraBUs = basketsHeldBottom.minus(needed);

                // {rTok} = {BU} * {rTok / BU} (if needed == 0, conv rate is 1 rTok/BU)
                uint192 rTok = (needed > 0) ? extraBUs.mulDiv(totalSupply, needed) : extraBUs;

                // gas-optimization: RToken is known to have 18 decimals, same as FixLib
                rToken.mint(address(this), uint256(rTok));
                rToken.setBasketsNeeded(basketsHeldBottom);
                needed = basketsHeldBottom;
            }
        }

        // At this point, even though basketsNeeded may have changed:
        // - We're fully collateralized
        // - The BU exchange rate {BU/rTok} did not decrease

        // Keep a small buffer of individual collateral; "excess" assets are beyond the buffer.
        needed = needed.mul(FIX_ONE.plus(backingBuffer));

        // Handout excess assets above what is needed, including any recently minted RToken
        uint256 length = erc20s.length;
        RevenueTotals memory totals = distributor.totals();
        uint256[] memory toRSR = new uint256[](length);
        uint256[] memory toRToken = new uint256[](length);
        for (uint256 i = 0; i < length; ++i) {
            IAsset asset = assetRegistry.toAsset(erc20s[i]);

            uint192 req = needed.mul(basketHandler.quantity(erc20s[i]), CEIL);
            if (asset.bal(address(this)).gt(req)) {
                // delta: {qTok}, the excess quantity of this asset that we hold
                uint256 delta = asset.bal(address(this)).minus(req).shiftl_toUint(
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
            IERC20 erc20 = IERC20(address(erc20s[i]));
            if (toRToken[i] > 0) erc20.safeTransfer(address(rTokenTrader), toRToken[i]);
            if (toRSR[i] > 0) erc20.safeTransfer(address(rsrTrader), toRSR[i]);
        }

        // It's okay if there is leftover dust for RToken or a surplus asset (not RSR)
    }

    /// Compromise on how many baskets are needed in order to recollateralize-by-accounting
    /// @param basketsHeldBottom {BU} The number of full basket units held by the BackingManager
    /// @param basketsNeeded {BU} RToken.basketsNeeded()
    function compromiseBasketsNeeded(uint192 basketsHeldBottom, uint192 basketsNeeded) private {
        // assert(tradesOpen == 0 && !basketHandler.fullyCollateralized());
        assert(tradesOpen == 0 && basketsHeldBottom < basketsNeeded);
        rToken.setBasketsNeeded(basketsHeldBottom);
    }

    /// Require all the pre-conditions to trading of any kind
    function requireReadyToTrade() private view {
        require(tradesOpen == 0, "trade open");
        require(basketHandler.isReady(), "basket not ready");
        require(block.timestamp >= whenNextTrade, "cooling down");
        require(block.timestamp >= basketHandler.timestamp() + tradingDelay, "trading delayed");
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

    /// @custom:governance
    function setTradeCooldown(uint48 val) public governance {
        require(val <= MAX_TRADE_COOLDOWN, "invalid tradeCooldown");
        emit TradeCooldownSet(tradeCooldown, val);
        tradeCooldown = val;
    }

    /**
     * @dev This empty reserved space is put in place to allow future versions to add new
     * variables without shifting down storage in the inheritance chain.
     * See https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps
     */
    uint256[40] private __gap;
}
