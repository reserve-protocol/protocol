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

        // Don't sell dust
        if (sellAmount.lt(dustThreshold(sell))) return (false, trade);

        // {sellTok}
        uint192 s = fixMin(sellAmount, sell.maxTradeVolume().div(sell.price(), FLOOR));

        // {qSellTok}
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

    // Used to avoided stack-too-deep errors
    struct BasketRange {
        uint192 top; // {BU}
        uint192 bottom; // {BU}
    }

    /// Select and prepare a trade that moves us closer to capitalization using the
    /// basket range to avoid overeager/duplicate trading.
    function prepareTradeRecapitalize()
        external
        view
        returns (bool doTrade, TradeRequest memory req)
    {
        IERC20[] memory erc20s = assetRegistry().erc20s();

        // Compute basket range
        BasketRange memory range = basketRange(erc20s); // {BU}

        // Determine the largest surplus and largest deficit relative to the basket range
        (
            IAsset surplus,
            ICollateral deficit,
            uint192 surplusAmount,
            uint192 deficitAmount
        ) = nextTradePair(erc20s, range);

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

    /// A range of baskets representing optimistic and pessimistic estimates
    function basketRange(IERC20[] memory erc20s) private view returns (BasketRange memory range) {
        uint192 basketPrice = basket().price();

        /**
         * - `assetsHigh`: The most we could get out of our assets. Assumes frictionless trades
         *     and reliable prices.
         * - `assetsLow`: The least we could get out of our assets. Assumes frictionless trades
         *     and zero for uncertain prices.
         */
        (uint192 assetsHigh, uint192 assetsLow) = totalAssetValue(erc20s); // {UoA}

        // {UoA} - Optimistic estimate of the value of the target number of basket units
        uint192 basketTargetHigh = fixMin(assetsHigh, rToken().basketsNeeded().mul(basketPrice));

        // Total value of missing collateral
        // Algo: For each collateral in the basket, compute the missing token balance relative to
        // the high basket target and convert this quantity to UoA using current market prices.
        uint192 shortfall = collateralShortfall(erc20s, basketTargetHigh); // {UoA}

        // Further adjust the low backing estimate downwards to account for trading frictions
        uint192 shortfallSlippage = maxTradeSlippage().mul(shortfall);
        uint192 basketTargetLow = assetsLow.gt(shortfallSlippage)
            ? fixMin(assetsLow.minus(shortfallSlippage), basketTargetHigh)
            : 0;

        // {BU} = {UoA} / {BU/UoA}
        range.top = basketTargetHigh.div(basketPrice, CEIL);
        range.bottom = basketTargetLow.div(basketPrice, CEIL);
    }

    /// Total value of all assets under management by BackingManager
    /// This includes all assets that the BackingManager holds directly + staked RSR
    /// @return assetsHigh {UoA} The high estimate of the total value of assets under management
    /// @return assetsLow {UoA} The low estimate of the total value of assets under management
    function totalAssetValue(IERC20[] memory erc20s)
        private
        view
        returns (uint192 assetsHigh, uint192 assetsLow)
    {
        // The low estimate is lower than the high estimate due to:
        // - Discounting unsound collateral
        // - Discounting dust amounts for collateral in the basket + non-dust assets

        IERC20 rsrERC20 = rsr();
        IBasketHandler bh = basket();
        uint192 dust = dustValue();
        uint32 potentialDustTraps; // {num assets}

        for (uint256 i = 0; i < erc20s.length; ++i) {
            IAsset asset = assetRegistry().toAsset(erc20s[i]);
            uint192 bal = asset.bal(address(this));

            // For RSR, include the staking balance
            if (erc20s[i] == rsrERC20) bal = bal.plus(asset.bal(address(stRSR())));

            // Ignore dust amounts for assets not in the basket; their value is inaccessible
            bool inBasket = bh.quantity(erc20s[i]).gt(FIX_ZERO);
            if (!inBasket && bal.lt(dustThreshold(asset))) {
                continue;
            }

            // {UoA} = {UoA} + {UoA/tok} * {tok}
            uint192 val = asset.price().mul(bal, FLOOR);

            // Consider all managed assets at face-value prices
            assetsHigh = assetsHigh.plus(val);
            ++potentialDustTraps;

            // Consider only reliable sources of value for the assetsLow estimate
            if (
                !asset.isCollateral() ||
                ICollateral(address(asset)).status() == CollateralStatus.SOUND
            ) {
                assetsLow = assetsLow.plus(val);
            }
        }

        // Account for all the places dust could get stuck, which should be equal to the number
        // of basket collateral plus the number of assets with non-dust balances, minus 1
        uint192 dustUncertainty = dust.mulu(potentialDustTraps - 1);
        assetsLow = assetsLow.gt(dustUncertainty) ? assetsLow.minus(dustUncertainty) : FIX_ZERO;
    }

    /// @param backing {UoA} An amount of backing in UoA terms
    /// @return shortfall {UoA} The missing re-collateralization in UoA terms
    function collateralShortfall(IERC20[] memory erc20s, uint192 backing)
        private
        view
        returns (uint192 shortfall)
    {
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
                shortfall = shortfall.plus(needed.minus(held).mul(coll.price(), FLOOR));
            }
        }
    }

    // Choose next sell/buy pair to trade, with reference to the basket range
    // Exclude dust amounts for surplus
    /// @return surplus Surplus asset OR address(0)
    /// @return deficit Deficit collateral OR address(0)
    /// @return surplusAmt {sellTok} Surplus amount (whole tokens)
    /// @return deficitAmt {buyTok} Deficit amount (whole tokens)
    function nextTradePair(IERC20[] memory erc20s, BasketRange memory range)
        private
        view
        returns (
            IAsset surplus,
            ICollateral deficit,
            uint192 surplusAmt,
            uint192 deficitAmt
        )
    {
        IBasketHandler bh = basket();
        uint192 maxSurplus; // {UoA}
        uint192 maxDeficit; // {UoA}

        for (uint256 i = 0; i < erc20s.length; ++i) {
            if (erc20s[i] == rsr()) continue;
            // TODO gas optimize by eliminating rsr() call each iteration

            IAsset asset = assetRegistry().toAsset(erc20s[i]);
            uint192 bal = asset.bal(address(this));

            // {tok} = {BU} * {tok/BU}
            // needed(Top): token balance needed at top of the basket range
            uint192 needed = range.top.mul(bh.quantity(erc20s[i]), CEIL); // {tok}
            if (bal.gt(needed)) {
                // {UoA} = ({tok} - {tok}) * {UoA/tok}
                uint192 delta = bal.minus(needed).mul(asset.price(), FLOOR);
                if (delta.gt(maxSurplus) && delta.gt(dustValue())) {
                    surplus = asset;
                    maxSurplus = delta;

                    // {tok} = {UoA} / {UoA/tok}
                    surplusAmt = maxSurplus.div(surplus.price());
                    if (bal.lt(surplusAmt)) surplusAmt = bal;
                }
            } else {
                // needed(Bottom): token balance needed at bottom of the basket range
                needed = range.bottom.mul(bh.quantity(erc20s[i]), CEIL); // {tok};
                if (bal.lt(needed)) {
                    // {UoA} = ({tok} - {tok}) * {UoA/tok}
                    uint192 delta = needed.minus(bal).mul(asset.price(), CEIL);
                    if (delta.gt(maxDeficit)) {
                        deficit = ICollateral(address(asset));
                        maxDeficit = delta;

                        // {tok} = {UoA} / {UoA/tok}
                        deficitAmt = maxDeficit.div(deficit.price(), CEIL);
                    }
                }
            }
        }

        // Use RSR if needed
        if (address(surplus) == address(0) && address(deficit) != address(0)) {
            IAsset rsrAsset = assetRegistry().toAsset(rsr());

            uint192 rsrAvailable = rsrAsset.bal(address(this)).plus(rsrAsset.bal(address(stRSR())));
            if (rsrAvailable.gt(dustThreshold(rsrAsset))) {
                surplus = rsrAsset;
                surplusAmt = rsrAvailable;
            }
        }
    }

    /// Assuming we have `maxSellAmount` sell tokens available, prepare a trade to
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

    /// @return {UoA} The least amount of whole tokens ever worth trying to sell, in UoA
    function dustValue() private view returns (uint192) {
        return ITrading(address(this)).dustAmount();
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
