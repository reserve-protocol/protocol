// SPDX-License-Identifier: BlueOak-1.0.0
pragma solidity 0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "contracts/interfaces/IAsset.sol";
import "contracts/interfaces/IAssetRegistry.sol";
import "contracts/interfaces/IMain.sol";
import "contracts/interfaces/ITrading.sol";
import "contracts/libraries/Fixed.sol";

/**
 * @title TradingLibP0
 * @notice An informal extension of the Trading mixin that provides trade preparation views
 * @dev The caller must implement the ITrading interface!
 */
library TradingLibP0 {
    using FixLib for int192;

    /// Prepare an trade to sell `sellAmount` that guarantees a reasonable closing price,
    /// without explicitly aiming at a particular quantity to purchase.
    /// @param sellAmount {sellTok}
    /// @return notDust True when the trade is larger than the dust amount
    /// @return trade The prepared trade
    function prepareTradeSell(
        IAsset sell,
        IAsset buy,
        int192 sellAmount
    ) public view returns (bool notDust, TradeRequest memory trade) {
        assert(sell.price().neq(FIX_ZERO) && buy.price().neq(FIX_ZERO));
        trade.sell = sell;
        trade.buy = buy;

        // Don't buy dust.
        if (sellAmount.lt(dustThreshold(sell))) return (false, trade);

        // {sellTok}
        int192 fixSellAmount = fixMin(sellAmount, sell.maxTradeVolume().div(sell.price()));
        trade.sellAmount = fixSellAmount.shiftLeft(int8(sell.erc20().decimals())).floor();

        // {buyTok} = {sellTok} * {UoA/sellTok} / {UoA/buyTok}
        int192 exactBuyAmount = fixSellAmount.mul(sell.price()).div(buy.price());
        int192 minBuyAmount = exactBuyAmount.mul(FIX_ONE.minus(maxTradeSlippage()));
        trade.minBuyAmount = minBuyAmount.shiftLeft(int8(buy.erc20().decimals())).ceil();
        return (true, trade);
    }

    /// Assuming we have `maxSellAmount` sell tokens avaialable, prepare an trade to
    /// cover as much of our deficit as possible, given expected trade slippage.
    /// @param maxSellAmount {sellTok}
    /// @param deficitAmount {buyTok}
    /// @return notDust Whether the prepared trade is large enough to be worth trading
    /// @return trade The prepared trade
    function prepareTradeToCoverDeficit(
        IAsset sell,
        IAsset buy,
        int192 maxSellAmount,
        int192 deficitAmount
    ) public view returns (bool notDust, TradeRequest memory trade) {
        // Don't sell dust.
        if (maxSellAmount.lt(dustThreshold(sell))) return (false, trade);

        // Don't buy dust.
        deficitAmount = fixMax(deficitAmount, dustThreshold(buy));

        // {sellTok} = {buyTok} * {UoA/buyTok} / {UoA/sellTok}
        int192 exactSellAmount = deficitAmount.mul(buy.price()).div(sell.price());
        // exactSellAmount: Amount to sell to buy `deficitAmount` if there's no slippage

        // idealSellAmount: Amount needed to sell to buy `deficitAmount`, counting slippage
        int192 idealSellAmount = exactSellAmount.div(FIX_ONE.minus(maxTradeSlippage()));

        int192 sellAmount = fixMin(idealSellAmount, maxSellAmount);
        return prepareTradeSell(sell, buy, sellAmount);
    }

    // Compute max surpluse relative to basketTop and max deficit relative to basketBottom
    /// @param sellRSR If true, consider RSR a sellable asset
    /// @param useFallenTarget If true, trade towards a reduced BU target
    /// @return surplus Surplus asset OR address(0)
    /// @return deficit Deficit collateral OR address(0)
    /// @return sellAmount {sellTok} Surplus amount (whole tokens)
    /// @return buyAmount {buyTok} Deficit amount (whole tokens)
    function largestSurplusAndDeficit(bool sellRSR, bool useFallenTarget)
        external
        view
        returns (
            IAsset surplus,
            ICollateral deficit,
            int192 sellAmount,
            int192 buyAmount
        )
    {
        IERC20[] memory erc20s = assetRegistry().erc20s();

        // Compute basketTop and basketBottom
        // basketTop is the lowest number of BUs to which we'll try to sell surplus assets
        // basketBottom is the greatest number of BUs to which we'll try to buy deficit assets
        int192 basketTop = rToken().basketsNeeded(); // {BU}
        int192 basketBottom = basketTop;

        if (useFallenTarget) {
            int192 tradeVolume = FIX_ZERO;
            int192 totalValue = FIX_ZERO;
            for (uint256 i = 0; i < erc20s.length; i++) {
                IAsset asset = assetRegistry().toAsset(erc20s[i]);
                totalValue = totalValue.plus(asset.bal(address(this)).mul(asset.price()));
            }
            basketTop = totalValue.div(basket().price());

            for (uint256 i = 0; i < erc20s.length; i++) {
                IAsset asset = assetRegistry().toAsset(erc20s[i]);
                if (!asset.isCollateral()) continue;
                int192 needed = basketTop.mul(basket().quantity(erc20s[i]));
                int192 held = asset.bal(address(this));

                if (held.lt(needed)) {
                    tradeVolume = tradeVolume.plus(needed.minus(held).mul(asset.price()));
                }
            }

            basketBottom = basketTop.mul(
                FIX_ONE.minus(maxTradeSlippage().mul(tradeVolume).div(totalValue))
            ); // {BU}
        }

        int192 max = FIX_ZERO; // {UoA} positive!
        int192 min = FIX_ZERO; // {UoA} negative!
        for (uint256 i = 0; i < erc20s.length; i++) {
            if (!sellRSR && erc20s[i] == rsr()) continue;
            IAsset asset = assetRegistry().toAsset(erc20s[i]);

            int192 tokenTop = FIX_ZERO; // {tok}
            int192 tokenBottom = FIX_ZERO; // {tok}

            if (asset.isCollateral()) {
                tokenTop = basketTop.mul(basket().quantity(erc20s[i]));
                tokenBottom = basketBottom.mul(basket().quantity(erc20s[i]));
            }

            int192 deltaTop = asset.bal(address(this)).minus(tokenTop).mul(asset.price());
            int192 deltaBottom = asset.bal(address(this)).minus(tokenBottom).mul(asset.price());

            if (deltaTop.gt(max)) {
                surplus = asset;
                max = deltaTop;
                sellAmount = max.div(surplus.price());
            } else if (deltaBottom.lt(min)) {
                deficit = ICollateral(address(asset));
                min = deltaBottom;
                buyAmount = min.minus(min).minus(min).div(deficit.price());
            }
        }
    }

    // === Getters ===

    /// @return {%}
    function maxTradeSlippage() private view returns (int192) {
        return ITrading(address(this)).maxTradeSlippage();
    }

    /// @return {tok} The least amount of whole tokens ever worth trying to sell
    function dustThreshold(IAsset asset) private view returns (int192) {
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
}
