# Recollateralization Trading Algorithm

Recollateralization takes place in the central loop of [`BackingManager.rebalance()`](../contracts/p1/BackingManager). Since the BackingManager can only have open 1 trade at a time, it needs to know which tokens to try to trade and how much. This algorithm should not be gameable and aims to minimize unnecessary loss.

```solidity
(bool doTrade, TradeRequest memory req, TradePrices memory prices) = RecollateralizationLibP1.prepareRecollateralizationTrade(..);
```

The trading algorithm is isolated in [RecollateralizationLib.sol](../contracts/p1/mixins/RecollateralizationLib.sol). This document describes the algorithm implemented by the library at a high-level, as well as the concepts required to evaluate the correctness of the implementation.

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

### Assumptions

1. **prices do not change throughout the rebalancing process**
   this is not strictly true, but enables reasoning about the algorithm

2. **RToken supply does not change throughout the rebalancing process**
   also not strictly true, but enables more straightforward reasoning

3. **trades will clear within the price ranges specified**
   this should be strictly true, guaranteed by the trading plugins themselves

4. **minTradeVolume is much smaller than the RSR overcollateralization layer**
   without this property the algorithm may take a haircut surprisingly early

### The BU price band - `basketRange()`

The BU price band is a two-sided range in units of `{BU}` that describes the realistic range of basket units that the protocol expects to end up with after it is done trading. The lower bound indicates the number of basket units that the protocol will hold if future trading proceeds as pessimistically as possible. The upper bound indicates how many BUs the BackingManager will hold if trading proceeds as optimistically as possible.

The spread between `basketRange.top` and `basketRange.bottom` represents the uncertainty that arises from:

1.  the oracleErrors of the oracles informing each asset's price
2.  the [`maxTradeSlippage`](system-design.md#maxTradeSlippage) governance param
3.  potentially accruable dust balances due to the [`minTradeVolume`](system-design.md#rTokenMinTradeVolume)

The algorithm should have the property that the overall spread between `basketRange.top` and `basketRange.bottom` should fall over time, as trades complete.

#### `basketRange.top`

In the optimistic case we assume we start with `basketsHeldBy(backingManager).top` basket units and deduct from this the balance deficit for each backing collateral in terms of basket units (converted optimistically, selling at the high price and buying at the low). Slippage is assumed to be 0, and no value is inaccessible due to the minTradeVolume. Finally we add-in contributions from all surplus balances, selling at the high price and buying at the low.

> basketsHeldBy(backingManager).top = BU max across each collateral; how many BUs would be held if only that collateral were the limiting factor (no trading allowed)

Therefore `basketRange.top` is the number of BUs we would end up with after recapitalization if everything went as well as possible.

#### `basketRange.bottom`

In the pessimistic case, we assume we start with `basketsHeldBy(backingManager).bottom` basket units and trade all surplus balances above this threshold, selling at the low price and buying at the high price. Slippage is assumed to be the full `maxTradeSlippage`, and `minTradeVolume` value is lost per each asset requiring trading. In this case there are no deficit balances relative to `basketsHeldBy(backingManager).bottom` by definition.

> basketsHeldBy(backingManager).bottom = BU min across each collateral; how many BUs would be held if all collateral is the limiting factor (no trading allowed)

Therefore `basketRange.bottom` is the number of BUs we would end up with after recapitalization if everything went as poorly as possible.

### Selecting the Trade - `nextTradePair()`

The `basketRange` BU price band is used to define token surplus/deficit: available token surplus is relative to `basketRange.top` while token deficit is relative to `basketRange.bottom`.

This allows the protocol to deterministically select the next trade based on the following set of constraints (in this order of consideration):

1. Always sell more than the [`minTradeVolume`](system-design.md#minTradeVolume) governance param
2. Never sell more than the [`maxTradeVolume`](system-design.md#rTokenMaxTradeVolume) governance params (note each asset has its own `maxTradeVolume`)
3. Sell `DISABLED` collateral first, `SOUND` next, and `IFFY` last.
   (Non-collateral assets are considered SOUND for these purposes. IFFY assets are sold last since they may recover their value in the future)
4. Do not double-trade SOUND assets: Capital that is traded from SOUND asset A -> SOUND asset B should not eventually be traded into SOUND asset C.
   (Caveat: if the protocol gets an unreasonably good trade in excess of what was indicated by an asset's price range, this can happen)
5. Large trades first, as determined by comparison in the `{UoA}`

If there does not exist a trade that meets these constraints, the protocol considers the RSR balance in StRSR before moving to "take a haircut", which is a colloquial way of saying it reduces `RToken.basketsNeeded()` to its current BU holdings to become by-definition collateralized. This causes a loss for RToken holders (undesirable) but causes the protocol to regain normal function.

#### Trade Sizing

All trades have a worst-case exchange rate that is a function of (among other things) the selling asset's `price().low` and the buying asset's `price().high`.

If there does not exist a trade that meets these constraints, then the protocol "takes a haircut", which is a colloquial way of saying it reduces `RToken.basketsNeeded()` to its current BU holdings `basketRange.bottom`. This causes a loss for RToken holders (undesirable) but causes the protocol to become collateralized again, allowing it to resume normal operation.

### Sizing the trade - `prepareTradeToCoverDeficit` vs `prepareTradeSell`

There are two ways trades can be sized.

The primary sizing method is `prepareTradeToCoverDeficit`, which takes the buy amount as a target and calculates a sell amount that is obviously sufficient. This may end up buying excess collateral since it takes a pessimistic view of where the trade may clear.

The secondary sizing method is `prepareTradeSell`, which takes the sell amount as a target and doesn't specify a buy amount. It is only used in cases where the sell asset is either unpriced (`[0, FIX_MAX]`) or IFFY/DISABLED collateral. If collateral is priced, then the trade will still be constrained by the max trade sizing. Only if the asset is unpriced will the entire balance of the token be sold. This is deemed acceptable because of the weeklong price decay period during which there will be multiple opportunities to sell the asset before its low price reaches 0.

## Summary

- Sell known bad collateral before known good collateral, and before unknown collateral
- Sell RSR last
- Trade as much as possible within the `maxTradeVolume` constraints of each asset without risking future double-trading
- With each successive trade the BU price band should narrow, opening up more token balance as surplus or giving the protocol confidence to buy more deficit collateral
