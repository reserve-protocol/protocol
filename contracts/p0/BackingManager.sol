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
    using FixLib for int192;
    using SafeERC20 for IERC20;

    uint32 public tradingDelay; // {s} how long to wait until resuming trading after switching
    int192 public backingBuffer; // {%} how much extra backing collateral to keep

    function init(
        IMain main_,
        uint32 tradingDelay_,
        int192 backingBuffer_,
        int192 maxTradeSlippage_,
        int192 dustAmount_
    ) public initializer {
        __Component_init(main_);
        __Trading_init(maxTradeSlippage_, dustAmount_);
        tradingDelay = tradingDelay_;
        backingBuffer = backingBuffer_;
    }

    // Give RToken max allowance over a registered token
    /// @custom:action
    function grantRTokenAllowance(IERC20 erc20) external action {
        require(main.assetRegistry().isRegistered(erc20), "erc20 unregistered");
        erc20.approve(address(main.rToken()), type(uint256).max);
    }

    /// Mointain the overall backing policy; handout assets otherwise
    /// @custom:action
    function manageTokens(IERC20[] calldata erc20s) external action {
        // Call keepers before
        main.poke();

        if (tradesOpen > 0) return;

        // Do not trade when DISABLED or IFFY
        require(main.basketHandler().status() == CollateralStatus.SOUND, "basket not sound");

        (, uint256 basketTimestamp) = main.basketHandler().lastSet();
        if (block.timestamp < basketTimestamp + tradingDelay) return;

        if (main.basketHandler().fullyCapitalized()) {
            handoutExcessAssets(erc20s);
        } else {
            /*
             * Recapitalization Strategy
             *
             * Trading one at a time...
             *   1. Make largest purchase possible on path towards rToken.basketsNeeded()
             *     a. Sell non-RSR assets first
             *     b. Sell RSR when no asset has a surplus > dust amount
             *   2. When RSR holdings < dust:
             *     -  Sell non-RSR surplus assets towards the Fallen Target
             *   3. When this produces trade sizes < dust:
             *     -  Set rToken.basketsNeeded() to basketsHeldBy(address(this))
             *
             * Fallen Target: The market-equivalent of all current holdings, in terms of BUs
             *   Note that the Fallen Target is freshly calculated during each pass
             */

            ///                       Baskets Needed
            ///                              |
            ///                              |
            ///                              |
            ///             1a               |            1b
            ///                              |
            ///                              |
            ///                              |
            ///                              |
            ///  non-RSR ------------------------------------------ RSR
            ///                              |
            ///                              |
            ///                              |
            ///                              |
            ///             2                |
            ///                              |
            ///                              |
            ///                              |
            ///                              |
            ///                        Fallen Target

            // 1a
            (bool doTrade, TradeRequest memory req) = nonRSRTrade(false);

            if (!doTrade) {
                // 1b
                (doTrade, req) = rsrTrade();
            }

            if (!doTrade) {
                // 2
                (doTrade, req) = nonRSRTrade(true);
            }

            if (doTrade) {
                tryTrade(req);
            } else {
                // 3
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
        int192 needed; // {BU}
        {
            IRToken rToken = main.rToken();
            needed = rToken.basketsNeeded(); // {BU}
            int192 held = main.basketHandler().basketsHeldBy(address(this)); // {BU}
            if (held.gt(needed)) {
                int8 decimals = int8(rToken.decimals());
                int192 totalSupply = shiftl_toFix(rToken.totalSupply(), -decimals); // {rTok}

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

            int192 bal = asset.bal(address(this)); // {tok}
            int192 req = needed.mul(main.basketHandler().quantity(erc20s[i]), CEIL);

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

    /// Prepare asset-for-collateral trade
    /// @param useFallenTarget When true, trade towards a reduced BU target based on holdings
    /// @return doTrade If the trade request should be performed
    /// @return req The prepared trade request
    function nonRSRTrade(bool useFallenTarget)
        private
        view
        returns (bool doTrade, TradeRequest memory req)
    {
        assert(tradesOpen == 0 && !main.basketHandler().fullyCapitalized());

        (
            IAsset surplus,
            ICollateral deficit,
            int192 surplusAmount,
            int192 deficitAmount
        ) = TradingLibP0.largestSurplusAndDeficit(useFallenTarget);

        if (address(surplus) == address(0) || address(deficit) == address(0)) return (false, req);

        // Of primary concern here is whether we can trust the prices for the assets
        // we are selling. If we cannot, then we should not `prepareTradeToCoverDeficit`

        if (
            surplus.isCollateral() &&
            main.assetRegistry().toColl(surplus.erc20()).status() == CollateralStatus.DISABLED
        ) {
            (doTrade, req) = TradingLibP0.prepareTradeSell(surplus, deficit, surplusAmount);
            req.minBuyAmount = 0;
        } else {
            (doTrade, req) = TradingLibP0.prepareTradeToCoverDeficit(
                surplus,
                deficit,
                surplusAmount,
                deficitAmount
            );
        }

        if (req.sellAmount == 0) return (false, req);

        return (doTrade, req);
    }

    /// Prepare a trade with seized RSR to buy for missing collateral
    /// @return doTrade If the trade request should be performed
    /// @return req The prepared trade request
    function rsrTrade() private returns (bool doTrade, TradeRequest memory req) {
        assert(tradesOpen == 0 && !main.basketHandler().fullyCapitalized());
        require(main.assetRegistry().isRegistered(main.rsr()), "rsr unregistered");

        IStRSR stRSR = main.stRSR();
        IAsset rsrAsset = main.assetRegistry().toAsset(main.rsr());

        (, ICollateral deficit, , int192 deficitAmount) = TradingLibP0.largestSurplusAndDeficit(
            false
        );
        if (address(deficit) == address(0)) return (false, req);

        int192 availableRSR = rsrAsset.bal(address(this)).plus(rsrAsset.bal(address(stRSR)));

        (doTrade, req) = TradingLibP0.prepareTradeToCoverDeficit(
            rsrAsset,
            deficit,
            availableRSR,
            deficitAmount
        );

        if (doTrade) {
            int8 decimals = int8(IERC20Metadata(address(main.rsr())).decimals());
            uint256 rsrBal = rsrAsset.bal(address(this)).shiftl_toUint(decimals);
            if (req.sellAmount > rsrBal) {
                stRSR.seizeRSR(req.sellAmount - rsrBal);
            }
        }
        return (doTrade, req);
    }

    /// Compromise on how many baskets are needed in order to recapitalize-by-accounting
    function compromiseBasketsNeeded() private {
        assert(tradesOpen == 0 && !main.basketHandler().fullyCapitalized());
        main.rToken().setBasketsNeeded(main.basketHandler().basketsHeldBy(address(this)));
        assert(main.basketHandler().fullyCapitalized());
    }

    // === Setters ===

    /// @custom:governance
    function setTradingDelay(uint32 val) external governance {
        emit TradingDelaySet(tradingDelay, val);
        tradingDelay = val;
    }

    /// @custom:governance
    function setBackingBuffer(int192 val) external governance {
        emit BackingBufferSet(backingBuffer, val);
        backingBuffer = val;
    }
}
