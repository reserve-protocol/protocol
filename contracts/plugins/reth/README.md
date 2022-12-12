# rETH Collateral Plugin - Hackathon Submission
### Author: [shalzz](https://github.com/shalzz) 
Twitter: https://twitter.com/shalzzj

## Overview
This plugin provides for using rETH token as a collateral plugin using 
[revenue hiding][1] for smoothing for short dips in total ETH balance of the rocket pool
network.

## Units

| **Units**       | `tok`      | `ref`                                                   | `target` | `UoA` |
|-----------------|------------|---------------------------------------------------------|----------|-------|
| **Description** | rETH | ETH  | ETH | USD   |

## Defaulting Conditions

The rETH collateral can default in scenarios where there's a large number of
rocketpool validators that are slashed and the RPL token collateral is unable
to act as a sufficient backstop to prevent the exchange rate from decreasing.

In situations where there's a few small rocketpool validators that are slashed, revenue
hiding bring stability over these small fluctuations.

### Hard default:

- $\text{actualRefPerTok}  \lt \text{refPerTok} $

Where refPerTok is:
- $\frac{\text{refPerTok} * \text{marginRatio}}{10000} $

## Deployment

Deploy [RETHCollateral.sol](./RETHCollateral.sol) with construct args: 

```
uint192 fallbackPrice_,  // fallback price
AggregatorV3Interface refUnitUSDChainlinkFeed_, // {uoa/ref} chainlink feed, mostly USD/ETH
IERC20Metadata erc20_, // address of the rETH token - 0xae78736Cd615f374D3085123A210448E74Fc6393
uint192 maxTradeVolume_, // max trade volume - default
uint48 oracleTimeout_, // oracle price request timeout - default
bytes32 targetName_, // ETH
uint16 _allowedDropBasisPoints, // Basis point out of 10000 that is used to discount refPerTok
uint256 delayUntilDefault_ // decimals of underlying token - default
```

## Testing
The unit and integrations tests are implemented in
[RETHCollateral.test.ts](../../../test/integration/individual-collateral/RETHCollateral.test.ts) at 
`test/integration/individual-collateral/RETHCollateral.test.ts`
and can run with the default blocknumber `14916729`

[1]: https://github.com/reserve-protocol/protocol/blob/master/docs/collateral.md#revenue-hiding
