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
    // Recall: struct TradeRequest is {IAsset sell, IAsset buy, uint sellAmount, uint minBuyAmount}
    //
    // If notDust is true, then the returned trade satisfies:
    //   trade.sell == sell and trade.buy == buy,
    //   trade.sellAmount and trade.minBuyAmount are the maximal values satisfying all of:
    //     trade.minBuyAmount ~= trade.sellAmount * sell.price()/buy.price() * (1-maxTradeSlippage)
    //     trade.sellAmount <= sellAmount.toQTok(sell)
    //     trade.sellAmount <= sell.maxTradeSize().toQTok(sell)
    //     trade.sellAmount <= GNOSIS_MAX_TOKENS
    //     trade.minBuyAmount <= GNOSIS_MAX_TOKENS,
    //   trade.sellAmount > 1
    //   trade.sellAmount >= sell.minTradeSize().toQTok(sell)
    //
    // If notDust is false, no trade exists that satisfies those constraints.
    function prepareTradeSell(
        IAsset sell,
        IAsset buy,
        uint192 sellAmount
    ) public view returns (bool notDust, TradeRequest memory trade) {
        trade.sell = sell;
        trade.buy = buy;

        // Don't sell dust
        if (sellAmount.lt(sell.minTradeSize())) return (false, trade);

        // {sellTok}
        uint192 s = fixMin(sellAmount, sell.maxTradeSize());

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

    // Used to avoid stack-too-deep errors
    struct BasketRange {
        uint192 top; // {BU}
        uint192 bottom; // {BU}
    }

    /// Select and prepare a trade that moves us closer to capitalization, using the
    /// basket range to avoid overeager/duplicate trading.
    // This is the "main loop" for recapitalization trading:
    // actions:
    //   let range = basketRange(all erc20s)
    //   let (surplus, deficit, amts...) = nextTradePair(all erc20s, range)
    //   if surplus.price() is reliable, prepareTradeToCoverDeficit(surplus, deficit, amts...)
    //   otherwise, prepareTradeSell(surplus, deficit, surplusAmt) with a 0 minBuyAmount
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
    /// The plausible range of BUs that the BackingManager will own by the end of recapitalization.
    /// @param erc20s Assets this computation presumes may be traded to raise funds.
    //
    // TODO: what if erc20s does not contain all basket collateral?
    //
    // This function returns a "plausible range of BUs" assuming that the trading process follows
    //     the follwing rules:
    //
    // - We will not aim to hold more than rToken.basketsNeeded() BUs
    // - No double trades: if we buy B in one trade, we won't sell B in another trade
    // - The best amount of an asset we can sell is our balance;
    //       the worst is (our balance) - (its dust amount)
    // - The best price we might get for a trade is the current price estimate (frictionlessly)
    // - The worst price we might get for a trade between SOUND or IFFY collateral is the current
    //     price estimate * ( 1 - maxTradeSlippage )
    // - The worst price we might get for an UNPRICED or DISABLED collateral is 0.
    // - Given all that, we're aiming to hold as many BUs as possible using the assets we own.
    //
    // Given these assumptions
    // range.top = min(rToken().basketsNeeded, totalAssetValue(erc20s) / basket.price())
    //   because (totalAssetValue(erc20s) / basket.price()) is how many BUs we can hold assuming
    //   "best plausible" prices, and we won't try to hold more than rToken().basketsNeeded
    // range.bottom = TODO

    function basketRange(IERC20[] memory erc20s) private view returns (BasketRange memory range) {
        // basketPrice: The current UoA value of one basket.
        uint192 basketPrice = basket().price();

        // assetsHigh: The most value we could get from the assets in erc20,
        //             assuming frictionless trades at currently-estimated prices.
        // assetsLow: The least value we might get from the assets in erc20,
        //            assuming frictionless trades, zero value from unreliable prices, and
        //            dustAmount of assets left in each Asset.
        (uint192 assetsHigh, uint192 assetsLow) = totalAssetValue(erc20s); // {UoA}

        // {UoA}, Optimistic estimate of the value of our basket units at the end of this
        //   recapitalization process.
        uint192 basketTargetHigh = fixMin(assetsHigh, rToken().basketsNeeded().mul(basketPrice));

        // {UoA}, Total value of collateral in shortfall of `basketTargetHigh`. Specifically:
        //   sum( shortfall(c, basketTargetHigh / basketPrice) for each erc20 c in the basket)
        //   where shortfall(c, numBUs) == (numBus * bh.quantity(c) - c.balanceOf(this)) * c.price()
        //         (that is, shortfall(c, numBUs) is the market value of the c that `this` would
        //          need to be given in order to have enough of c to cover `numBUs` BUs)
        uint192 shortfall = collateralShortfall(erc20s, basketTargetHigh); // {UoA}

        // ==== Further adjust the low backing estimate downwards to account for trading frictions

        // {UoA}, Total value of the slippage we'd see if we made `shortfall` trades with
        //     slippage `maxTradeSlippage()`
        uint192 shortfallSlippage = maxTradeSlippage().mul(shortfall);

        // {UoA}, Pessimistic estimate of the value of our basket units at the end of this
        //   recapitalization process.
        uint192 basketTargetLow = assetsLow.gt(shortfallSlippage)
            ? fixMin(assetsLow.minus(shortfallSlippage), basketTargetHigh)
            : 0;

        // {BU} = {UoA} / {BU/UoA}
        range.top = basketTargetHigh.div(basketPrice, CEIL);
        range.bottom = basketTargetLow.div(basketPrice, CEIL);
    }

    /// Total value of the erc20s under management by BackingManager
    /// This may include BackingManager's balances _and_ staked RSR hold by stRSR
    /// @param erc20s tokens to consider "under management" by BackingManager in this computation
    /// @return assetsHigh {UoA} The high estimate of the total value of assets under management
    /// @return assetsLow {UoA} The low estimate of the total value of assets under management

    // preconditions:
    //   `this` is backingManager
    //   erc20s has no duplicates
    // checks:
    //   for e in erc20s, e has a registered asset in the assetRegistry
    // return values:
    // assetsHigh: The most value we could get from the assets in erc20,
    //             assuming frictionless trades at currently-estimated prices.
    // assetsLow: The least value we might get from the assets in erc20,
    //            assuming frictionless trades, zero value from unreliable prices, and
    //            dustAmount of assets left in each Asset.
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
        uint192 potentialDustLoss; // {UoA}

        // Accumulate:
        // - assetsHigh: sum(bal(e)*price(e) for e ... )
        // - potentialDustLoss: sum(minTradeSize(e) for e ... )
        // - assetsLow: sum(bal(e)*price(e) for e ... if e.status() == SOUND or e is just an Asset)
        for (uint256 i = 0; i < erc20s.length; ++i) {
            IAsset asset = assetRegistry().toAsset(erc20s[i]);
            uint192 bal = asset.bal(address(this));

            // For RSR, include the staking balance
            if (erc20s[i] == rsrERC20) bal = bal.plus(asset.bal(address(stRSR())));

            // Ignore dust amounts for assets not in the basket; their value is inaccessible
            bool inBasket = bh.quantity(erc20s[i]).gt(FIX_ZERO);
            if (!inBasket && bal.lt(asset.minTradeSize())) {
                continue;
            }

            // {UoA} = {UoA} + {UoA/tok} * {tok}
            uint192 val = asset.price().mul(bal, FLOOR);

            // Consider all managed assets at face-value prices
            assetsHigh = assetsHigh.plus(val);

            // Accumulate potential losses to dust
            potentialDustLoss = potentialDustLoss.plus(asset.minTradeSize());

            // Consider only reliable sources of value for the assetsLow estimate
            if (
                !asset.isCollateral() ||
                ICollateral(address(asset)).status() == CollateralStatus.SOUND
            ) {
                assetsLow = assetsLow.plus(val);
            }
        }

        // Account for all the places dust could get stuck
        // assetsLow' = max(assetsLow-potentialDustLoss, 0)
        assetsLow = assetsLow.gt(potentialDustLoss) ? assetsLow.minus(potentialDustLoss) : FIX_ZERO;
    }

    /// @param backing {UoA} An amount of backing in UoA terms
    /// @return shortfall {UoA} The missing re-collateralization in UoA terms
    // Specifically, returns:
    //   sum( shortfall(c, basketTargetHigh / basketPrice) for each erc20 c in the basket)
    //   where shortfall(c, numBUs) == (numBus * bh.quantity(c) - c.balanceOf(this)) * c.price()
    //         (that is, shortfall(c, numBUs) is the market value of the c that `this` would
    //          need to be given in order to have enough of c to cover `numBUs` BUs)
    // precondition: erc20s contains no duplicates; all basket tokens are in erc20s
    function collateralShortfall(IERC20[] memory erc20s, uint192 backing)
        private
        view
        returns (uint192 shortfall)
    {
        IBasketHandler bh = basket();

        uint192 basketPrice = bh.price(); // {UoA/BU}

        // accumulate shortfall
        for (uint256 i = 0; i < erc20s.length; ++i) {
            uint192 quantity = bh.quantity(erc20s[i]); // {tok/BU}
            if (quantity.eq(FIX_ZERO)) continue; // skip any collateral not needed

            // Cast: if the quantity is nonzero, then it must be collateral
            ICollateral coll = assetRegistry().toColl(erc20s[i]);

            // {tok} = {UoA} * {tok/BU} / {UoA/BU}
            // needed: quantity of erc20s[i] needed in basketPrice's worth of baskets
            uint192 needed = backing.mulDiv(quantity, basketPrice, CEIL); // {tok}
            // held: quantity of erc20s[i] owned by `this`
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
    // Defining "surplus" and "deficit":
    // If bal(e) > (quantity(e) * range.top), then e is in surplus by the difference
    // If bal(e) < (quantity(e) * range.bottom), then e is in deficit by the difference
    //
    // First, ignoring RSR:
    //   `surplus` is the token from erc20s with the greatest surplus value (in UoA),
    //   and surplusAmt is the quantity of that token that it's in surplus (in qTok).
    //   if `surplus` == 0, then no token is in surplus by at least minTradeSize and surplusAmt == 0
    //
    //   `deficit` is the token from erc20s with the greatest deficit value (in UoA),
    //   and deficitAmt is the quantity of that token that it's in deficit (in qTok).
    //   if `deficit` == 0, then no token is in deficit at all, and deficitAmt == 0
    //
    // Then, just if we have deficit and no surplus, consider treating available RSR as surplus.
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
            // needed(Top): token balance needed for range.top baskets: quantity(e) * range.top
            uint192 needed = range.top.mul(bh.quantity(erc20s[i]), CEIL); // {tok}
            if (bal.gt(needed)) {
                // {UoA} = ({tok} - {tok}) * {UoA/tok}
                // delta: the surplus amount of `asset` in UoA
                uint192 delta = bal.minus(needed).mul(asset.price(), FLOOR);

                // {tok} = {UoA} / {UoA/tok}
                // amt: the surplus amount of `asset` in tokens of asset.erc20
                uint192 amt = delta.div(asset.price());
                if (delta.gt(maxSurplus) && amt.gt(asset.minTradeSize())) {
                    surplus = asset;
                    maxSurplus = delta;

                    // {tok} = {UoA} / {UoA/tok}
                    surplusAmt = amt;
                    if (bal.lt(surplusAmt)) surplusAmt = bal;
                }
            } else {
                // needed(Bottom): token balance needed at bottom of the basket range
                needed = range.bottom.mul(bh.quantity(erc20s[i]), CEIL); // {tok};
                if (bal.lt(needed)) {
                    // {UoA} = ({tok} - {tok}) * {UoA/tok}
                    // delta: the deficit amount of `asset` in UoA
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
            if (rsrAvailable.gt(rsrAsset.minTradeSize())) {
                surplus = rsrAsset;
                surplusAmt = rsrAvailable;
            }
        }
    }

    /// Assuming we have `maxSellAmount` sell tokens available, prepare a trade to cover as much of
    /// our deficit of `deficitAmount` buy tokens as possible, given expected trade slippage the
    /// sell asset's maxTradeVolume().
    /// @param maxSellAmount {sellTok}
    /// @param deficitAmount {buyTok}
    /// @return notDust Whether the prepared trade is large enough to be worth trading
    /// @return trade The prepared trade
    //
    // Returns prepareTradeSell(sell, buy, sellAmount), where
    //   sellAmount = min(maxSellAmount,
    //                    deficitAmount * (buy.price / sell.price) / (1-maxTradeSlippage))
    //   i.e, the minimum of maxSellAmount and (a sale amount that, at current prices and maximum
    //   slippage, will yield at least the requested deficitAmount)
    //
    // Which means we should get that, if notDust is true, then:
    //   trade.sell = sell and trade.buy = buy
    //
    //   1 <= trade.minBuyAmount <= min(max(deficitAmount, buy.minTradeSize()).toQTok(buy),
    //                                  GNOSIS_MAX_TOKENS)
    //   1 < trade.sellAmount <= min(maxSellAmount.toQTok(sell),
    //                               sell.maxTradeSize().toQTok(sell),
    //                               GNOSIS_MAX_TOKENS)
    //   trade.minBuyAmount ~= trade.sellAmount * sell.price() / buy.price() * (1-maxTradeSlippage)
    //
    //   trade.sellAmount (and trade.minBuyAmount) are maximal satisfying all these conditions
    function prepareTradeToCoverDeficit(
        IAsset sell,
        IAsset buy,
        uint192 maxSellAmount,
        uint192 deficitAmount
    ) private view returns (bool notDust, TradeRequest memory trade) {
        // Don't buy dust.
        deficitAmount = fixMax(deficitAmount, buy.minTradeSize());

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
