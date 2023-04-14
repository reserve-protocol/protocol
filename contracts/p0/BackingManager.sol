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

    uint48 public tradingDelay; // {s} how long to wait until resuming trading after switching
    uint192 public backingBuffer; // {%} how much extra backing collateral to keep

    function init(
        IMain main_,
        uint48 tradingDelay_,
        uint192 backingBuffer_,
        uint192 maxTradeSlippage_,
        uint192 maxTradeVolume_
    ) public initializer {
        __Component_init(main_);
        __Trading_init(maxTradeSlippage_, maxTradeVolume_);
        setTradingDelay(tradingDelay_);
        setBackingBuffer(backingBuffer_);
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
    function manageTokens(IERC20[] calldata erc20s) external notPausedOrFrozen {
        // Token list must not contain duplicates
        require(ArrayLib.allUnique(erc20s), "duplicate tokens");
        _manageTokens(erc20s);
    }

    /// Maintain the overall backing policy; handout assets otherwise
    /// @dev Tokens must be in sorted order!
    /// @dev Performs a uniqueness check on the erc20s list in O(n)
    /// @custom:interaction
    function manageTokensSortedOrder(IERC20[] calldata erc20s) external notPausedOrFrozen {
        // Token list must not contain duplicates
        require(ArrayLib.sortedAndAllUnique(erc20s), "duplicate/unsorted tokens");
        _manageTokens(erc20s);
    }

    function _manageTokens(IERC20[] calldata erc20s) private {
        // Call keepers before
        main.poke();

        if (tradesOpen > 0) return;

        // Do not trade when not SOUND
        require(main.basketHandler().status() == CollateralStatus.SOUND, "basket not sound");

        uint48 basketTimestamp = main.basketHandler().timestamp();
        if (block.timestamp < basketTimestamp + tradingDelay) return;

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

                tryTrade(req);
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
}
