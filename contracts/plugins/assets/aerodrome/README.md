# Aerodrome Collateral Plugins

[Aerodrome Finance](https://aerodrome.finance) is an AMM designed to serve as Base's central liquidity hub. This plugin enables the use of any Aerodrome Stable and Volatile LP token as collateral within the Reserve Protocol.

Aerodrome Finance offers two different liquidity pool types based on token pair needs, `Stable Pools` and `Volatile Pools`.

`Stable Pools` are designed for tokens which have little to no volatility, and use the current formula for pricing tokens: `x³y + y³x ≥ k`

`Volatile Pools` are designed for tokens with high price volatility, and use a generic AMM formula: `x × y ≥ k`

## Usage

### Number of Tokens in The Pool

All Aerodrome Pools are designed to support `2 (two)` tokens. So this field is harcoded and not provided as a configuration deployment parameter.

### Multiple Price Feeds

Some tokens require multiple price feeds since they do not have a direct price feed to USD. One example of this is WBTC. To support this, the plugin accepts a `tokensPriceFeeds` field in the configuration deployment parameter. This data structure is a `address[][]` and should have the same length as the number of coins in the Pool. The indices of these price feeds should also match the indices of the tokens in the pool. For example, if I am deploying a collateral plugin for the USDC/EUSD, I would need to pass something like `[[USDC_USD_FEED_ADDR], [EUSD_USD_FEED_ADDR]]` as `tokensPriceFeeds`. Since USDC has an index of 0 in the Aerodrome USDC/eUSD pool, the USDC price feed should be in index 0 in `tokensPriceFeeds`.

### Wrapped Stake Token

Since the Aerodrome LP Token needs to be staked in the Gauge to get rewards in AERO, we need to wrap it in another ERC20-token. This repo includes an `AerodromeGaugeStakingWrapper` contract that needs to be deployed and its address passed as the `erc20` configuration parameter.

### Rewards

Rewards come in the form of AERO tokens, which will be distributed once `claimRewards()` is called.

AERO token: `https://basescan.org/token/0x940181a94a35a4569e4529a3cdfb74e38fd98631`

## Implementation Notes

### Immutable Arrays for Price Feeds

Internally, all `tokensPriceFeeds` are stored as multiple separate immutable variables instead of just one array-type state variable for each. This is a gas-optimization done to avoid using SSTORE/SLOAD opcodes which are necessary but expensive operations when using state variables. Immutable variables, on the other hand, are embedded in the bytecode and are much cheaper to use which leads to more gas-efficient `price`, `strictPrice` and `refresh` functions. This work-around is necessary since Solidity does not yet support immutable arrays.

### refPerTok

Aerodrome Pools do not appreciate in value over time, so `refPerTok()` will be constant for these plugins and will not change. This also means there are no hard default checks in place.

## Implementation

         |        `tok`         |       `ref`       |   `target` | `UoA` |
         | :------------------: | :---------------: | :--------: | :---: |

Stable | Aero Staking Wrapper | LP token /w shift | USD | USD |
Volatile | Aero Staking Wrapper | LP token /w shift | cpAMM | USD |
