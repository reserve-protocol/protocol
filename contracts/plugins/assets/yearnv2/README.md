# Yearn V2 Collateral Plugin

## Summary

This plugin allows Yearn V2 yToken holders to use their tokens as collateral in the Reserve Protocol. (Currently only USD\*-crvUSD yTokens are supported)

Yearn is is a defi strategy platform that allows users to optimize their defi participation collectively as a group. It handles things like (i) autocompounding, (ii) reward monetization, and (iii) taps into boosted yields.

Yearn V2 only has 1 function of interest to the Reserve Protocol: `pricePerShare() external view returns (uint256)`. There is no mutator call required in order to update the rate. There is a background `harvest()` step that returns yields from the strategy to the yToken, but this happens continuously over many hours instead of discretely in a single block. Since we can count on Yearn keepers calling `harvest()` for us, we do not need to mutate the yToken ourselves.

However, we also need to take into account the underlying token's `get_virtual_price()`. The complete `refPerTok()` measure is the product of `pricePerShare()` and `get_virtual_price`.

There are no rewards to claim as YFI is not emitted that way, and the reward tokens of underlying defi protocols are already converted under the hood for yToken holders.

## Implementation

### Units

For the example of `yvCurveUSDCcrvUSD`:

| tok               | ref                          | target | UoA |
| ----------------- | ---------------------------- | ------ | --- |
| yvCurveUSDCcrvUSD | crvUSDUSDC-f's virtual token | USD    | USD |

Subtlety: crvUSDUSDC-f has a virtual price, so the ref token is not _quite_ crvUSDUSDC-f but actually its virtual token. That is, when `get_virtual_price()` is 1.1, the ref token is the underlying virtual token that the LP token can be redeemed for at a 1.1:1 ratio.

### Functions

#### refPerTok {ref/tok}

```solidity
// {ref/tok} = {qRef/tok} * {ref/qRef}
return shiftl_toFix(IYearnV2(erc20).pricePerShare(), -int8(erc20.decimals()));
```
