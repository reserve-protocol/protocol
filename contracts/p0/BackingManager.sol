// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./mixins/TradingLib.sol";
import "./mixins/Trading.sol";
import "../interfaces/IAsset.sol";
import "../interfaces/IAssetRegistry.sol";
import "../interfaces/IBroker.sol";
import "../interfaces/IMain.sol";
import "../libraries/Array.sol";
import "../libraries/Fixed.sol";

/**
 * @title BackingManager
 * @notice The backing manager holds + manages the backing for an RToken
 */
contract BackingManagerP0 is TradingP0, IBackingManager {
    using FixLib for uint192;
    using SafeERC20 for IERC20;

    uint48 public constant MAX_TRADING_DELAY = 31536000; // {s} 1 year
    uint192 public constant MAX_BACKING_BUFFER = 1e18; // {%}
    uint192 public constant MAX_TRADE_COOLDOWN = 86400; // {s} 24hr

    uint48 public tradingDelay; // {s} how long to wait until resuming trading after switching
    uint192 public backingBuffer; // {%} how much extra backing collateral to keep
    uint48 public tradeCooldown; // {s} number of seconds between any type of trade
    uint48 public whenNextTrade; // {s} block timestamp at which can next trade

    function init(
        IMain main_,
        uint48 tradingDelay_,
        uint192 backingBuffer_,
        uint192 maxTradeSlippage_,
        uint192 maxTradeVolume_,
        uint192 swapPricepoint_,
        uint48 tradeCooldown_
    ) public initializer {
        __Component_init(main_);
        __Trading_init(maxTradeSlippage_, maxTradeVolume_, swapPricepoint_);
        setTradingDelay(tradingDelay_);
        setBackingBuffer(backingBuffer_);
        setTradeCooldown(tradeCooldown_);
    }

    // Give RToken max allowance over a registered token
    /// @dev Performs a uniqueness check on the erc20s list in O(n^2)
    /// @custom:interaction
    function grantRTokenAllowance(IERC20 erc20) external notFrozen {
        require(main.assetRegistry().isRegistered(erc20), "erc20 unregistered");
        erc20.safeApprove(address(main.rToken()), 0);
        erc20.safeApprove(address(main.rToken()), type(uint256).max);
    }

    /// Maintain the overall backing policy; handout assets otherwise
    /// @custom:interaction
    function manageTokens(IERC20[] calldata erc20s) external notTradingPausedOrFrozen {
        // Token list must not contain duplicates
        require(ArrayLib.allUnique(erc20s), "duplicate tokens");
        _manageTokens(erc20s);
    }

    /// Maintain the overall backing policy; handout assets otherwise
    /// @dev Tokens must be in sorted order!
    /// @dev Performs a uniqueness check on the erc20s list in O(n)
    /// @custom:interaction
    function manageTokensSortedOrder(IERC20[] calldata erc20s) external notTradingPausedOrFrozen {
        // Token list must not contain duplicates
        require(ArrayLib.sortedAndAllUnique(erc20s), "duplicate/unsorted tokens");
        _manageTokens(erc20s);
    }

    function _manageTokens(IERC20[] calldata erc20s) private {
        // Call keepers before
        main.poke();

        if (tradesOpen > 0) return;

        // Ensure basket is ready, SOUND and not in warmup period
        require(main.basketHandler().isReady(), "basket not ready");

        uint48 basketTimestamp = main.basketHandler().timestamp();
        require(block.timestamp >= basketTimestamp + tradingDelay, "trading delayed");

        BasketRange memory basketsHeld = main.basketHandler().basketsHeldBy(address(this));

        if (main.basketHandler().fullyCollateralized()) {
            handoutExcessAssets(erc20s, basketsHeld.bottom);
        } else {
            /*
             * Recollateralization
             *
             * Strategy: iteratively move the system on a forgiving path towards capitalization
             * through a narrowing BU price band. The initial large spread reflects the
             * uncertainty associated with the market price of defaulted/volatile collateral, as
             * well as potential losses due to trading slippage. In the absence of further
             * collateral default, the size of the BU price band should decrease with each trade
             * until it is 0, at which point capitalization is restored.
             *
             * ======
             *
             * If we run out of capital and are still undercollateralized, we compromise
             * rToken.basketsNeeded to the current basket holdings. Haircut time.
             */

            (bool doTrade, TradeRequest memory req) = TradingLibP0.prepareRecollateralizationTrade(
                this,
                basketsHeld
            );

            if (doTrade) {
                // Seize RSR if needed
                if (req.sell.erc20() == main.rsr()) {
                    uint256 bal = req.sell.erc20().balanceOf(address(this));
                    if (req.sellAmount > bal) main.stRSR().seizeRSR(req.sellAmount - bal);
                }

                openTrade(req);
            } else {
                // Haircut time
                compromiseBasketsNeeded(basketsHeld.bottom);
            }
        }
    }

    /// Send excess assets to the RSR and RToken traders
    /// @param wholeBasketsHeld {BU} The number of full basket units held by the BackingManager
    function handoutExcessAssets(IERC20[] calldata erc20s, uint192 wholeBasketsHeld) private {
        assert(main.basketHandler().status() == CollateralStatus.SOUND);

        // Special-case RSR to forward to StRSR pool
        uint256 rsrBal = main.rsr().balanceOf(address(this));
        if (rsrBal > 0) {
            main.rsr().safeTransfer(address(main.stRSR()), rsrBal);
        }

        // Mint revenue RToken
        uint192 needed; // {BU}
        {
            IRToken rToken = main.rToken();
            needed = rToken.basketsNeeded(); // {BU}
            if (wholeBasketsHeld.gt(needed)) {
                int8 decimals = int8(rToken.decimals());
                uint192 totalSupply = shiftl_toFix(rToken.totalSupply(), -decimals); // {rTok}

                // {BU} = {BU} - {BU}
                uint192 extraBUs = wholeBasketsHeld.minus(needed);

                // {qRTok: Fix} = {BU} * {qRTok / BU} (if needed == 0, conv rate is 1 qRTok/BU)
                uint192 rTok = (needed > 0) ? extraBUs.mulDiv(totalSupply, needed) : extraBUs;

                rToken.mint(address(this), rTok);
                rToken.setBasketsNeeded(wholeBasketsHeld);
            }
        }

        // Keep a small surplus of individual collateral
        needed = main.rToken().basketsNeeded().mul(FIX_ONE.plus(backingBuffer));

        // Handout excess assets above what is needed, including any newly minted RToken
        RevenueTotals memory totals = main.distributor().totals();
        for (uint256 i = 0; i < erc20s.length; i++) {
            IAsset asset = main.assetRegistry().toAsset(erc20s[i]);

            uint192 bal = asset.bal(address(this)); // {tok}
            uint192 req = needed.mul(main.basketHandler().quantity(erc20s[i]), CEIL);

            if (bal.gt(req)) {
                // delta: {qTok}
                uint256 delta = bal.minus(req).shiftl_toUint(int8(asset.erc20Decimals()));
                uint256 tokensPerShare = delta / (totals.rTokenTotal + totals.rsrTotal);

                {
                    uint256 toRSR = tokensPerShare * totals.rsrTotal;
                    if (toRSR > 0) erc20s[i].safeTransfer(address(main.rsrTrader()), toRSR);
                }
                {
                    uint256 toRToken = tokensPerShare * totals.rTokenTotal;
                    if (toRToken > 0)
                        erc20s[i].safeTransfer(address(main.rTokenTrader()), toRToken);
                }
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
        main.assetRegistry().refresh();

        // Get precise Swap
        s = getSwap();
        whenNextTrade = uint48(block.timestamp) + tradeCooldown;

        // Require the calculated swap is better than the passed-in swap
        require(s.sell == tokenOut && s.buy == tokenIn, "swap tokens changed");
        require(s.sellAmount >= minAmountOut, "output amount fell");
        require(s.buyAmount <= maxAmountIn, "input amount increased");

        // Seize RSR if needed
        if (s.sell == main.rsr()) {
            uint256 bal = s.sell.balanceOf(address(this));
            if (s.sellAmount > bal) main.stRSR().seizeRSR(s.sellAmount - bal);
        }

        executeSwap(s);
    }

    /// @return The next Swap, without refreshing the assetRegistry
    function getSwap() public view returns (Swap memory) {
        require(tradesOpen == 0, "trade open");
        require(main.basketHandler().isReady(), "basket not ready");
        require(block.timestamp >= whenNextTrade, "cooling down");
        require(
            block.timestamp >= main.basketHandler().timestamp() + tradingDelay,
            "trading delayed"
        );

        // TradeRequest from manageTokens()
        (bool doTrade, TradeRequest memory req) = TradingLibP0.prepareRecollateralizationTrade(
            this,
            main.basketHandler().basketsHeldBy(address(this))
        );

        require(doTrade, "swap not available");
        return TradingLibP0.prepareSwap(req, swapPricepoint, SwapVariant.CALCULATE_SELL_AMOUNT);
    }

    /// Compromise on how many baskets are needed in order to recollateralize-by-accounting
    /// @param wholeBasketsHeld {BU} The number of full basket units held by the BackingManager
    function compromiseBasketsNeeded(uint192 wholeBasketsHeld) private {
        assert(tradesOpen == 0 && !main.basketHandler().fullyCollateralized());
        main.rToken().setBasketsNeeded(wholeBasketsHeld);
        assert(main.basketHandler().fullyCollateralized());
    }

    // === Setters ===

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
}
