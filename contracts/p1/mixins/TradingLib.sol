// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/interfaces/IAsset.sol";
import "contracts/interfaces/IAssetRegistry.sol";
import "contracts/interfaces/ITrading.sol";
import "contracts/libraries/Fixed.sol";

// Gnosis: uint96 ~= 7e28
uint256 constant GNOSIS_MAX_TOKENS = 7e28;

/**
 * @title TradingLibP1
 * @notice An informal extension of the Trading mixin that provides trade preparation views
 * @dev The caller must implement the ITrading interface!
 *
 * External-facing interface:
 *  1. prepareTradeSell
 *  2. prepareTradeRecapitalize
 */
library TradingLibP1 {
    using FixLib for uint192;

    // Needed to avoided stack-too-deep errors
    struct BasketBand {
        uint192 top; // {UoA}
        uint192 bottom; // {UoA}
    }

    /// Prepare a trade to sell `sellAmount` that guarantees a reasonable closing price,
    /// without explicitly aiming at a particular quantity to purchase.
    /// @param sellAmount {sellTok}
    /// @return notDust True when the trade is larger than the dust amount
    /// @return trade The prepared trade
    function prepareTradeSell(
        IAsset sell,
        IAsset buy,
        uint192 sellAmount
    ) public view returns (bool notDust, TradeRequest memory trade) {
        trade.sell = sell;
        trade.buy = buy;

        // Don't sell dust.
        if (sellAmount.lt(dustThreshold(sell))) return (false, trade);

        // {sellTok}
        uint192 s = fixMin(sellAmount, sell.maxTradeVolume().div(sell.price(), FLOOR));
        trade.sellAmount = s.shiftl_toUint(int8(sell.erc20().decimals()), FLOOR);

        // Do not consider 1 qTok a viable sell amount
        if (trade.sellAmount <= 1) return (false, trade);

        // Do not overflow auction mechanism - sell side
        if (trade.sellAmount > GNOSIS_MAX_TOKENS) {
            trade.sellAmount = GNOSIS_MAX_TOKENS;
            s = shiftl_toFix(trade.sellAmount, -int8(sell.erc20().decimals()));
        }

        // {buyTok} = {sellTok} * {UoA/sellTok} / {UoA/buyTok}
        uint192 b = s.mul(FIX_ONE.minus(maxTradeSlippage())).mulDiv(
            sell.price(),
            buy.price(),
            CEIL
        );
        trade.minBuyAmount = b.shiftl_toUint(int8(buy.erc20().decimals()), CEIL);

        // Do not overflow auction mechanism - buy side
        if (trade.minBuyAmount > GNOSIS_MAX_TOKENS) {
            uint192 over = FIX_ONE.muluDivu(trade.minBuyAmount, GNOSIS_MAX_TOKENS);
            trade.sellAmount = divFix(trade.sellAmount, over).toUint(FLOOR);
            trade.minBuyAmount = divFix(trade.minBuyAmount, over).toUint(CEIL);
        }
        return (true, trade);
    }

    /// Select and prepare a trade that moves us closer to capitalization using the
    /// BU price band to avoid overeager/duplicate trading.
    function prepareTradeRecapitalize(bool useRSR)
        external
        view
        returns (bool doTrade, TradeRequest memory req)
    {
        // TODO useRSR
        IERC20[] memory erc20s = assetRegistry().erc20s();

        // Compute the BU price band
        BasketBand memory band = basketBand(useRSR, erc20s);

        // Determine the largest surplus and largest deficit relative to basketTop/basketBottom
        (
            IAsset surplus,
            ICollateral deficit,
            uint192 surplusAmount,
            uint192 deficitAmount
        ) = largestSurplusAndDeficit(useRSR, erc20s, band);

        if (address(surplus) == address(0) || address(deficit) == address(0)) return (false, req);

        // If we cannot trust surplus.price(), eliminate the minBuyAmount requirement

        if (
            surplus.isCollateral() &&
            assetRegistry().toColl(surplus.erc20()).status() != CollateralStatus.SOUND
        ) {
            (doTrade, req) = prepareTradeSell(surplus, deficit, surplusAmount);
            req.minBuyAmount = 0;
        } else {
            (doTrade, req) = prepareTradeToCoverDeficit(
                surplus,
                deficit,
                surplusAmount,
                deficitAmount
            );
        }

        if (req.sellAmount == 0) return (false, req);

        return (doTrade, req);
    }

    // ==== End of external interface; Begin private helpers ===

    // Compute largest surplus relative to band.top/bottom
    /// @return surplus Surplus asset OR address(0)
    /// @return deficit Deficit collateral OR address(0)
    /// @return sellAmount {sellTok} Surplus amount (whole tokens)
    /// @return buyAmount {buyTok} Deficit amount (whole tokens)
    function largestSurplusAndDeficit(
        bool useRSR,
        IERC20[] memory erc20s,
        BasketBand memory band
    )
        private
        view
        returns (
            IAsset surplus,
            ICollateral deficit,
            uint192 sellAmount,
            uint192 buyAmount
        )
    {
        IBasketHandler bh = basket();
        uint192 maxSurplus; // {UoA}
        uint192 maxDeficit; // {UoA}

        for (uint256 i = 0; i < erc20s.length; ++i) {
            IAsset asset = assetRegistry().toAsset(erc20s[i]);
            uint192 bal = asset.bal(address(this));

            // Token Threshold - most
            uint192 needed = band.top.mul(bh.quantity(erc20s[i]), CEIL); // {tok};
            if (bal.gt(needed)) {
                // {UoA} = ({tok} - {tok}) * {UoA/tok}
                uint192 deltaTop = bal.minus(needed).mul(asset.price(), FLOOR);
                if (deltaTop.gt(maxSurplus)) {
                    surplus = asset;
                    maxSurplus = deltaTop;

                    // {tok} = {UoA} / {UoA/tok}
                    sellAmount = maxSurplus.div(surplus.price());
                    if (bal.lt(sellAmount)) sellAmount = bal;
                }
            } else {
                // Token Threshold - least
                needed = band.bottom.mul(bh.quantity(erc20s[i]), CEIL); // {tok}
                if (bal.lt(needed)) {
                    // {UoA} = ({tok} - {tok}) * {UoA/tok}
                    uint192 deltaBottom = needed.minus(bal).mul(asset.price(), CEIL);
                    if (deltaBottom.gt(maxDeficit)) {
                        deficit = ICollateral(address(asset));
                        maxDeficit = deltaBottom;

                        // {tok} = {UoA} / {UoA/tok}
                        buyAmount = maxDeficit.div(deficit.price(), CEIL);
                    }
                }
            }
        }
    }

    /// Calculate the band of possible
    function basketBand(bool useRSR, IERC20[] memory erc20s)
        private
        view
        returns (BasketBand memory band)
    {
        /**
         * - `high`: The largest amount of {UoA} that we could reasonably expect to manifest
         *     as basket backing. Assumes no slippage and predictable prices.
         * - `low`: The smallest amount of value that might ultimately manifest as basket backing.
         *     Assumes max slippage and unreliable prices.
         */
        (uint192 high, uint192 low) = eventualBacking(useRSR, erc20s); // {UoA}

        // Tally up the missing collateral
        uint192 debt = tallyDebt(useRSR, erc20s, high); // {UoA}

        // Further adjust the low backing estimate downwards to account for possible slippage
        low = low.minus(maxTradeSlippage().mul(debt)); // {UoA}

        // {BU} = {UoA} / {BU/UoA}
        uint192 basketPrice = basket().price();
        band.top = high.div(basketPrice, CEIL);
        band.bottom = low.div(basketPrice, CEIL);
    }

    /// @return high {UoA} The high estimate of the eventual backing, in UoA terms
    /// @return low {UoA} The low estimate of the eventual backing, in UoA terms
    function eventualBacking(bool useRSR, IERC20[] memory erc20s)
        private
        view
        returns (uint192 high, uint192 low)
    {
        IBasketHandler bh = basket();

        for (uint256 i = 0; i < erc20s.length; ++i) {
            IAsset asset = assetRegistry().toAsset(erc20s[i]);

            // Ignore dust amounts for assets not in the basket; their value is inaccessible
            uint192 bal = asset.bal(address(this));
            if (bh.quantity(erc20s[i]).eq(FIX_ZERO) && bal.lt(dustThreshold(asset))) {
                continue;
            }

            // {UoA} = {UoA} + {UoA/tok} * {tok}
            uint192 val = asset.price().mul(bal, FLOOR);

            // Consider all accessible sources value for the high estimate
            high = high.plus(val);

            // Consider only reliable sources of value for the low estimate
            if (
                !asset.isCollateral() ||
                ICollateral(address(asset)).status() != CollateralStatus.SOUND
            ) {
                low = low.plus(val);
            }
        }
    }

    /// @param backing {UoA} An amount of backing in UoA terms
    /// @return debt_ {UoA} The missing re-collateralization in UoA terms
    function tallyDebt(
        bool useRSR,
        IERC20[] memory erc20s,
        uint192 backing
    ) private view returns (uint192 debt_) {
        IBasketHandler bh = basket();

        uint192 basketPrice = bh.price(); // {UoA/BU}
        for (uint256 i = 0; i < erc20s.length; ++i) {
            uint192 quantity = bh.quantity(erc20s[i]); // {tok/BU}
            if (quantity.eq(FIX_ZERO)) continue;

            // Cast: if the quantity is nonzero, then it must be collateral
            ICollateral coll = assetRegistry().toColl(erc20s[i]);

            // {tok} = {UoA} * {tok/BU} / {UoA/BU}
            uint192 needed = backing.mulDiv(quantity, basketPrice, CEIL); // {tok}
            uint192 held = coll.bal(address(this)); // {tok}

            if (held.lt(needed)) {
                // {UoA} = {UoA} + ({tok} - {tok}) * {UoA/tok}
                debt_ = debt_.plus(needed.minus(held).mul(coll.price(), FLOOR));
            }
        }
    }

    /// Assuming we have `maxSellAmount` sell tokens avaialable, prepare a trade to
    /// cover as much of our deficit as possible, given expected trade slippage and
    /// the sell asset's maxTradeVolume().
    /// @param maxSellAmount {sellTok}
    /// @param deficitAmount {buyTok}
    /// @return notDust Whether the prepared trade is large enough to be worth trading
    /// @return trade The prepared trade
    function prepareTradeToCoverDeficit(
        IAsset sell,
        IAsset buy,
        uint192 maxSellAmount,
        uint192 deficitAmount
    ) private view returns (bool notDust, TradeRequest memory trade) {
        // Don't sell dust.
        if (maxSellAmount.lt(dustThreshold(sell))) return (false, trade);

        // Don't buy dust.
        deficitAmount = fixMax(deficitAmount, dustThreshold(buy));

        // {sellTok} = {buyTok} * {UoA/buyTok} / {UoA/sellTok}
        uint192 exactSellAmount = deficitAmount.mulDiv(buy.price(), sell.price(), CEIL);
        // exactSellAmount: Amount to sell to buy `deficitAmount` if there's no slippage

        // slippedSellAmount: Amount needed to sell to buy `deficitAmount`, counting slippage
        uint192 slippedSellAmount = exactSellAmount.div(FIX_ONE.minus(maxTradeSlippage()), CEIL);

        uint192 sellAmount = fixMin(slippedSellAmount, maxSellAmount);
        return prepareTradeSell(sell, buy, sellAmount);
    }

    // ---- rest leftover kruft

    // /// Prepare a trade with seized RSR to buy for missing collateral
    // /// @return doTrade If the trade request should be performed
    // /// @return req The prepared trade request
    // function rsrTrade() external returns (bool doTrade, TradeRequest memory req) {
    //     IERC20 rsr_ = rsr();
    //     IStRSR stRSR_ = stRSR();
    //     IAsset rsrAsset = assetRegistry().toAsset(rsr_);

    //     (, ICollateral deficit, , uint192 deficitAmount) = largestSurplusAndDeficit(false);
    //     if (address(deficit) == address(0)) return (false, req);

    //     (doTrade, req) = prepareTradeToCoverDeficit(
    //         rsrAsset,
    //         deficit,
    //         rsrAsset.bal(address(this)).plus(rsrAsset.bal(address(stRSR_))),
    //         deficitAmount
    //     );

    //     if (doTrade) {
    //         uint256 rsrBal = rsrAsset.bal(address(this)).shiftl_toUint(
    //             int8(IERC20Metadata(address(rsr_)).decimals())
    //         );
    //         if (req.sellAmount > rsrBal) {
    //             stRSR_.seizeRSR(req.sellAmount - rsrBal);
    //         }
    //     }
    //     return (doTrade, req);
    // }

    // /// Prepare asset-for-collateral trade
    // /// @param useFallenTarget When true, trade towards a reduced BU target based on holdings
    // /// @return doTrade If the trade request should be performed
    // /// @return req The prepared trade request
    // function nonRSRTrade(bool useFallenTarget)
    //     external
    //     view
    //     returns (bool doTrade, TradeRequest memory req)
    // {
    //     (
    //         IAsset surplus,
    //         ICollateral deficit,
    //         uint192 surplusAmount,
    //         uint192 deficitAmount
    //     ) = largestSurplusAndDeficit(useFallenTarget);

    //     if (address(surplus) == address(0) || address(deficit) == address(0)) return (false, req);

    //     // Of primary concern here is whether we can trust the prices for the assets
    //     // we are selling. If we cannot, then we should ignore `maxTradeSlippage`.

    //     if (
    //         surplus.isCollateral() &&
    //         assetRegistry().toColl(surplus.erc20()).status() == CollateralStatus.DISABLED
    //     ) {
    //         (doTrade, req) = prepareTradeSell(surplus, deficit, surplusAmount);
    //         req.minBuyAmount = 0;
    //     } else {
    //         (doTrade, req) = prepareTradeToCoverDeficit(
    //             surplus,
    //             deficit,
    //             surplusAmount,
    //             deficitAmount
    //         );
    //     }

    //     if (req.sellAmount == 0) return (false, req);

    //     return (doTrade, req);
    // }

    // === Getters ===

    /// @return {%}
    function maxTradeSlippage() private view returns (uint192) {
        return ITrading(address(this)).maxTradeSlippage();
    }

    /// @return {tok} The least amount of whole tokens ever worth trying to sell
    function dustThreshold(IAsset asset) private view returns (uint192) {
        // {tok} = {UoA} / {UoA/tok}
        return ITrading(address(this)).dustAmount().div(asset.price());
    }

    /// @return The AssetRegistry
    function assetRegistry() private view returns (IAssetRegistry) {
        return ITrading(address(this)).main().assetRegistry();
    }

    /// @return The BasketHandler
    function basket() private view returns (IBasketHandler) {
        return ITrading(address(this)).main().basketHandler();
    }

    /// @return The RToken
    function rToken() private view returns (IRToken) {
        return ITrading(address(this)).main().rToken();
    }

    /// @return The RSR associated with this RToken
    function rsr() private view returns (IERC20) {
        return ITrading(address(this)).main().rsr();
    }

    function stRSR() private view returns (IStRSR) {
        return ITrading(address(this)).main().stRSR();
    }
}
