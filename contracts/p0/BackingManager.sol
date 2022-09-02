// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/p0/mixins/TradingLib.sol";
import "contracts/p0/mixins/Trading.sol";
import "contracts/interfaces/IAsset.sol";
import "contracts/interfaces/IAssetRegistry.sol";
import "contracts/interfaces/IBroker.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/libraries/Fixed.sol";

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
        uint192 maxTradeSlippage_
    ) public initializer {
        __Component_init(main_);
        __Trading_init(maxTradeSlippage_);
        setTradingDelay(tradingDelay_);
        setBackingBuffer(backingBuffer_);
    }

    // Give RToken max allowance over a registered token
    /// @custom:interaction
    function grantRTokenAllowance(IERC20 erc20) external notPausedOrFrozen {
        require(main.assetRegistry().isRegistered(erc20), "erc20 unregistered");

        uint256 currAllowance = erc20.allowance(address(this), address(main.rToken()));
        erc20.safeIncreaseAllowance(address(main.rToken()), type(uint256).max - currAllowance);
    }

    /// Mointain the overall backing policy; handout assets otherwise
    /// @custom:interaction
    function manageTokens(IERC20[] calldata erc20s) external notPausedOrFrozen {
        // Token list must not contain duplicates
        requireUnique(erc20s);

        // Call keepers before
        main.poke();

        if (tradesOpen > 0) return;

        // Do not trade when not SOUND
        require(main.basketHandler().status() == CollateralStatus.SOUND, "basket not sound");

        (, uint256 basketTimestamp) = main.basketHandler().lastSet();
        if (block.timestamp < basketTimestamp + tradingDelay) return;

        if (main.basketHandler().fullyCollateralized()) {
            handoutExcessAssets(erc20s);
        } else {
            /*
             * Recapitalization
             *
             * Strategy: iteratively move the system on a forgiving path towards capitalization
             * through a narrowing BU price band. The initial large spread reflects the
             * uncertainty associated with the market price of defaulted/volatile collateral, as
             * well as potential losses due to trading slippage. In the absence of further
             * collateral default, the size of the BU price band should decrease with each trade
             * until it is 0, at which point capitalization is restored.
             *
             * TODO
             * Argument for why this converges
             *
             * ======
             *
             * If we run out of capital and are still undercapitalized, we compromise
             * rToken.basketsNeeded to the current basket holdings. Haircut time.
             *
             * TODO
             * Argument for why this is ok and won't accidentally hurt RToken holders
             */

            (bool doTrade, TradeRequest memory req) = TradingLibP0.prepareTradeRecapitalize();

            if (doTrade) {
                // Seize RSR if needed
                if (req.sell.erc20() == main.rsr()) {
                    uint256 bal = req.sell.erc20().balanceOf(address(this));
                    if (req.sellAmount > bal) main.stRSR().seizeRSR(req.sellAmount - bal);
                }

                tryTrade(req);
            } else {
                // Haircut time
                compromiseBasketsNeeded();
            }
        }
    }

    /// Send excess assets to the RSR and RToken traders
    function handoutExcessAssets(IERC20[] calldata erc20s) private {
        assert(main.basketHandler().status() == CollateralStatus.SOUND);

        // Special-case RSR to forward to StRSR pool
        uint256 rsrBal = main.rsr().balanceOf(address(this));
        if (rsrBal > 0) {
            main.rsr().safeTransfer(address(main.rsrTrader()), rsrBal);
        }

        // Mint revenue RToken
        uint192 needed; // {BU}
        {
            IRToken rToken = main.rToken();
            needed = rToken.basketsNeeded(); // {BU}
            uint192 held = main.basketHandler().basketsHeldBy(address(this)); // {BU}
            if (held.gt(needed)) {
                int8 decimals = int8(rToken.decimals());
                uint192 totalSupply = shiftl_toFix(rToken.totalSupply(), -decimals); // {rTok}

                // {qRTok} = ({(BU - BU) * rTok / BU}) * {qRTok/rTok}
                uint256 rTok = held.minus(needed).mulDiv(totalSupply, needed).shiftl_toUint(
                    decimals
                );
                rToken.mint(address(this), rTok);
                rToken.setBasketsNeeded(held);
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
                uint256 delta = bal.minus(req).shiftl_toUint(int8(asset.erc20().decimals()));
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

    /// Compromise on how many baskets are needed in order to recapitalize-by-accounting
    function compromiseBasketsNeeded() private {
        assert(tradesOpen == 0 && !main.basketHandler().fullyCollateralized());
        main.rToken().setBasketsNeeded(main.basketHandler().basketsHeldBy(address(this)));
        assert(main.basketHandler().fullyCollateralized());
    }

    /// Require that all tokens in this array are unique
    function requireUnique(IERC20[] calldata erc20s) internal pure {
        for (uint256 i = 1; i < erc20s.length; i++) {
            for (uint256 j = 0; j < i; j++) {
                require(erc20s[i] != erc20s[j], "duplicate tokens");
            }
        }
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
