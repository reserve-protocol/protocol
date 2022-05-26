// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/interfaces/IAsset.sol";
import "contracts/interfaces/IBackingManager.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/libraries/Fixed.sol";
import "contracts/p1/mixins/Trading.sol";
import "contracts/p1/mixins/TradingLib.sol";

/**
 * @title BackingManager
 * @notice The backing manager holds + manages the backing for an RToken
 */

/// @custom:oz-upgrades-unsafe-allow external-library-linking
contract BackingManagerP1 is TradingP1, IBackingManager {
    using FixLib for uint192;
    using SafeERC20Upgradeable for IERC20Upgradeable;

    uint32 public tradingDelay; // {s} how long to wait until resuming trading after switching
    uint192 public backingBuffer; // {%} how much extra backing collateral to keep

    function init(
        IMain main_,
        uint32 tradingDelay_,
        uint192 backingBuffer_,
        uint192 maxTradeSlippage_,
        uint192 dustAmount_
    ) external initializer {
        __Component_init(main_);
        __Trading_init(maxTradeSlippage_, dustAmount_);
        tradingDelay = tradingDelay_;
        backingBuffer = backingBuffer_;
    }

    // Give RToken max allowance over a registered token
    /// @custom:interaction CEI
    function grantRTokenAllowance(IERC20 erc20) external interaction {
        require(main.assetRegistry().isRegistered(erc20), "erc20 unregistered");
        // == Interaction ==
        erc20.approve(address(main.rToken()), type(uint256).max);
    }

    /// Maintain the overall backing policy; handout assets otherwise
    /// @custom:interaction RCEI
    function manageTokens(IERC20[] calldata erc20s) external interaction {
        // == Refresh ==
        main.assetRegistry().refresh();

        if (tradesOpen > 0) return;
        // Do not trade when DISABLED or IFFY
        require(main.basketHandler().status() == CollateralStatus.SOUND, "basket not sound");

        (, uint256 basketTimestamp) = main.basketHandler().lastSet();
        if (block.timestamp < basketTimestamp + tradingDelay) return;

        if (main.basketHandler().fullyCapitalized()) {
            // == Interaction (then return) ==
            handoutExcessAssets(erc20s);
            return;
        } else {
            /*
             * Recapitalization Strategy
             *
             * Trading one at a time:
             *   1. Make largest purchase possible on path towards rToken.basketsNeeded()
             *     a. Sell non-RSR assets first
             *     b. Seize and sell RSR when no asset has a surplus > dust amount
             *   2. If rToken.basketsNeeded() can't be reached after seizing all RSR,
             *     -  Sell non-RSR surplus assets towards the Fallen Target
             *   3. If all trades are less than the dust amount,
             *     -  Set rToken.basketsNeeded() to basketsHeldBy(address(this))
             *
             * Fallen Target: The market-equivalent of all current holdings, in terms of BUs
             *   Note that the Fallen Target is freshly calculated during each pass
             */

            //                  | non-RSR | RSR |
            // |----------------|---------|-----|
            // | Baskets Needed | 1a      | 1b  |
            // | Fallen Target  | 2       |     |

            bool doTrade;
            TradeRequest memory req;

            // 1a
            (doTrade, req) = TradingLibP1.nonRSRTrade(false);
            // 1b
            if (!doTrade) (doTrade, req) = TradingLibP1.rsrTrade();
            // 2
            if (!doTrade) (doTrade, req) = TradingLibP1.nonRSRTrade(true);

            // 3
            if (!doTrade) {
                compromiseBasketsNeeded();
                return;
            }

            // == Interaction ==
            if (doTrade) tryTrade(req);
        }
    }

    /// Send excess assets to the RSR and RToken traders
    /// @custom:interaction CEI
    function handoutExcessAssets(IERC20[] calldata erc20s) private {
        IBasketHandler basketHandler = main.basketHandler();
        address rsrTrader = address(main.rsrTrader());
        address rTokenTrader = address(main.rTokenTrader());

        // Forward any RSR held to StRSR pool
        if (main.rsr().balanceOf(address(this)) > 0) {
            // We consider this an interaction "within our system" even though RSR is already live
            IERC20Upgradeable(address(main.rsr())).safeTransfer(
                address(main.rsrTrader()),
                main.rsr().balanceOf(address(this))
            );
        }

        // Mint revenue RToken
        uint192 needed; // {BU}
        {
            IRToken rToken = main.rToken();
            needed = rToken.basketsNeeded(); // {BU}
            uint192 held = basketHandler.basketsHeldBy(address(this)); // {BU}
            if (held.gt(needed)) {
                int8 decimals = int8(rToken.decimals());
                uint192 totalSupply = shiftl_toFix(rToken.totalSupply(), -decimals); // {rTok}

                // {qRTok} = ({(BU - BU) * rTok / BU}) * {qRTok/rTok}
                uint256 rTok = held.minus(needed).mulDiv(totalSupply, needed).shiftl_toUint(
                    decimals
                );
                rToken.mint(address(this), rTok);
                rToken.setBasketsNeeded(held);
                needed = held;
            }
        }

        // Keep a small surplus of individual collateral
        needed = needed.mul(FIX_ONE.plus(backingBuffer));

        // Handout excess assets above what is needed, including any newly minted RToken
        uint256 length = erc20s.length;
        RevenueTotals memory totals = main.distributor().totals();
        uint256[] memory toRSR = new uint256[](length);
        uint256[] memory toRToken = new uint256[](length);
        for (uint256 i = 0; i < length; ++i) {
            IAsset asset = main.assetRegistry().toAsset(erc20s[i]);

            uint192 req = needed.mul(basketHandler.quantity(erc20s[i]), CEIL);
            if (asset.bal(address(this)).gt(req)) {
                // delta: {qTok}
                uint256 delta = asset.bal(address(this)).minus(req).shiftl_toUint(
                    int8(IERC20Metadata(address(erc20s[i])).decimals())
                );
                toRSR[i] = (delta / (totals.rTokenTotal + totals.rsrTotal)) * totals.rsrTotal;
                toRToken[i] = (delta / (totals.rTokenTotal + totals.rsrTotal)) * totals.rTokenTotal;
            }
        }

        // == Interactions ==
        for (uint256 i = 0; i < length; ++i) {
            IERC20Upgradeable erc20 = IERC20Upgradeable(address(erc20s[i]));
            if (toRToken[i] > 0) erc20.safeTransfer(rTokenTrader, toRToken[i]);
            if (toRSR[i] > 0) erc20.safeTransfer(rsrTrader, toRSR[i]);
        }
    }

    /// Compromise on how many baskets are needed in order to recapitalize-by-accounting
    function compromiseBasketsNeeded() private {
        // TODO this might be the one assert we actually keep
        assert(tradesOpen == 0 && !main.basketHandler().fullyCapitalized());
        main.rToken().setBasketsNeeded(main.basketHandler().basketsHeldBy(address(this)));
    }

    // === Setters ===

    /// @custom:governance
    function setTradingDelay(uint32 val) external governance {
        emit TradingDelaySet(tradingDelay, val);
        tradingDelay = val;
    }

    /// @custom:governance
    function setBackingBuffer(uint192 val) external governance {
        emit BackingBufferSet(backingBuffer, val);
        backingBuffer = val;
    }
}
