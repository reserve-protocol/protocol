# Recollateralization Trading Algorithm

Recollateralization takes place in the central loop of [`BackingManager.rebalance()`](../contracts/p1/BackingManager). Since the BackingManager can only have open 1 trade at a time, it needs to know which tokens to try to trade and how much. This algorithm should not be gameable and should not result in unnecessary losses.

```solidity
(bool doTrade, TradeRequest memory req, TradePrices memory prices) = RecollateralizationLibP1.prepareRecollateralizationTrade(...);
```

The trading algorithm is isolated in [RecollateralizationLib.sol](../contracts/p1/mixins/RecollateralizationLib.sol). This document describes the algorithm implemented by the library at a high-level, as well as the concepts required to evaluate the correctness of the implementation.

Note: In case of an upwards default, as in a token is worth _more_ than what it is supposed to be, the token redemption is worth more than the peg during recollateralization process. This will continue to be the case until the rebalancing process is complete. This is a good thing, and the protocol should be able to take advantage of this.

## High-level overview

```solidity
   /*
    * Strategy: iteratively move the system on a forgiving path towards capitalization
    * through a narrowing BU price band. The initial large spread reflects the
    * uncertainty associated with the market price of defaulted/volatile collateral, as
    * well as potential losses due to trading slippage. In the absence of further
    * collateral default, the size of the BU price band should decrease with each trade
    * until it is 0, at which point capitalization is restored.
    ...
    * If we run out of capital and are still undercollateralized, we compromise
    * rToken.basketsNeeded to the current basket holdings. Haircut time.
    */
```

### The BU price band - `basketRange()`

The BU price band is a two-sided range in units of `{BU}` that describes the realistic range of basket units that the protocol expects to end up with after it is done trading. The lower bound indicates the number of basket units that the protocol will hold if future trading proceeds as pessimistically as possible. The upper bound indicates how many BUs the BackingManager will hold if trading proceeds as optimistically as possible.

The spread represents uncertainty that arises from (i) the uncertainty fundamental in asset prices: [`IAsset.price() returns (uint192 low, uint192 high)`](../contracts/interfaces/IAsset.sol), (ii) the [`BackingManager.maxTradeSlippage`](system-design.md#maxTradeSlippage) governance param, and (iii) potentially accruable dust balances due to the [`minTradeVolume`](system-design.md#rTokenMinTradeVolume) (unique per asset).

As trades complete, the distance between the top and bottom of the BU price band _strictly decreases_; it should not even remain the same (assuming the trade cleared for nonzero volume).

#### `basketRange.top`

In the optimistic case we assume we start with `basketsHeldBy(backingManager).top` basket units and deduct from this the balance deficit for each backing collateral in terms of basket units (converted optimistically). For deficits we assume the low sell price and high basket unit price. We assume no impact from maxTradeSlippage or minTradeVolume dust loss. Finally we add-in contributions from all surplus balances, this time assuming the high sell price and low basket unit price.

Altogether, this is how many BUs we would end up with after recapitalization if everything went as well as possible.

#### `basketRange.bottom`

In the pessimistic case, we assume we have with `basketsHeldBy(backingManager).bottom` basket units, and trade all surplus balances above this at the low sell price for the high price of a basket unit, as well as account for maxTradeSlippage and potentially up to a minTradeVolume dust loss.

There are no deficits to speak of in this case by definition.

### Selecting the Trade - `nextTradePair()`

The BU price band is used in order to determine token surplus/deficit: token surplus is defined relative to the top of the BU price band while token deficit is defined relative to the bottom of the BU price band

This allows the protocol to deterministically select the next trade based on the following set of constraints (in this order of consideration):

1. Always sell more than the [`minTradeVolume`](system-design.md#minTradeVolume) governance param
2. Never sell more than the [`maxTradeVolume`](system-design.md#rTokenMaxTradeVolume) governance param
3. Sell `DISABLED` collateral first, `SOUND` next, and `IFFY` last.
   (Non-collateral assets are considered SOUND for these purposes.)
4. Do not double-trade SOUND assets: Capital that is traded from SOUND asset A -> SOUND asset B should not eventually be traded into SOUND asset C.
   (Caveat: if the protocol gets an unreasonably good trade in excess of what was indicated by an asset's price range, this can happen)
5. Large trades first, as determined by comparison in the `{UoA}`

If there does not exist a trade that meets these constraints, then the protocol "takes a haircut", which is a colloquial way of saying it reduces `RToken.basketsNeeded()` to its current BU holdings. This causes a loss for RToken holders (undesirable) but causes the protocol to become collateralized again, allowing it to re-enter into a period of normal operation.

#### Trade Sizing

All trades have a worst-case exchange rate that is a function of (among other things) the selling asset's `price().low` and the buying asset's `price().high`.

#### Trade Examples

TODO

##### SOUND trades only (ie due to governance basket change)

##### DISABLED collateral sale

##### Haircut taken due to lack of RSR overcollateralization

## Summary

- Sell bad collateral before good collateral
- Trade as much as possible without risking future double-trading
- With each successive trade the BU price band should narrow, opening up more token balance for surplus or providing sufficient justification for the purchase of more deficit collateral.
