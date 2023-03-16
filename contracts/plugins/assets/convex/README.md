# Convex Curve StableSwap Collateral Plugin

_Note: This plugin was originally developed during the Reserve Protocol Hackathon and was later heavily modified by the Reserve team._

This repo contains a [Reserve Protocol](https://reserve.org/en/) collateral plugin for [Curve](https://curve.fi/#/ethereum/swap) StableSwap tokens staked in [Convex](https://www.convexfinance.com/).

This plugin enables the use of any Curve StableSwap Liquidity Token staked in Convex as collateral within the Reserve Protocol. There are 3 different types of Liquidity Pools in Curve:

1. Plain Pool - these are pools that directly hold the assets being exchanged in the pool. Examples of these are the Tri-Pool (DAI, USDC, USDT), STEH and SETH pools.
2. Lending Pool - tokens held are wrapped tokens representing the assets being lent to a Lending Protocol like Aave or Compound. There are AAVE and Compound pools.
3. Metapools - a pool that pairs a stablecoin with a Plain Pool's LP Token. An example of this is the GUSD metapool.

## Usage

### Number of Tokens in The Pool

`nTokens` is a field in the configuration deployment parameter that represents the number of tokens in the Liquidity Pool we want to deploy a collateral plugin for. This needs to match the number of tokens in the Liquidity Pool. Note that different pool types will require different sets of tokens as specified below:

1. Plain Pool - tokens are the ones we get from `curvePool.coins(uint256)`
2. Lending Pool - tokens are the ones we get from `curvePool.underlying_coins(uint256)`
3. Base Pool - tokens are the ones we get from `curvePool.base_coins(uint256)`

### Multiple Price Feeds

Some tokens require multiple price feeds since they do not have a direct price feed to USD. One example of this is WBTC. In ethereum mainnet, there is no WBTC-USD price feed (at time of writing.) To get the USD price of WBTC, we need the chainlink feeds WBTC-BTC and BTC-USD. To support this, the plugin accepts a `tokensPriceFeeds` field in the configuration deployment parameter. This data structure is a `address[][]` and should have the same length as the number of coins in the Plain Pool, or the number of underlying_coins in the Lending Pool, or the number of base_coins in the Metapool. The indices of these price feeds should also match the indices of the tokens in the pool. For example, if I am deploying a collateral plugin for the TRI-POOL(DAI, USDC, USDT), I would need to pass something like `[[DAI_USD_FEED_ADDR], [USDC_USD_FEED_ADDR], [USDT_USD_FEED_ADDR]]` as `tokensPriceFeeds`. Since DAI has an index of 0 in the TRI-POOL, the DAI price feed should be in index 0 in `tokensPriceFeeds`.

### Target Peg

The `targetPegFeed` configuration parameter is for setting the price feed for the target unit. If the StableSwap's target unit is ETH (meaning, the stablecoins in the swap are pegged to ETH), then we need to provide a reliable price feed for ETH-USD. If the StableSwap is pegged to USD and the collateral's Unit-of-Account is USD, then providing the zero address will mean the collateral will use 1 as the target peg.

### Wrapped Stake Token

Since we can not directly work with the Convex Stake Token, we need to wrap it in an ERC20-token. This repo comes with `ConvexStakingWrapper` contract copied from the Convex repo. That Wrapper contract will need to be deployed and its address passed as the `wrappedStakeToken` configuration parameter. Any existing valid wrapper token for the Convex Stake Token may also be used.

## Implementation Notes

### Immutable Arrays for Price Feeds

Internally, all `tokensPriceFeeds` are stored as multiple separate immutable variables instead of just one array-type state variable for each. This is a gas-optimization done to avoid using SSTORE/SLOAD opcodes which are necessary but expensive operations when using state variables. Immutable variables, on the other hand, are embedded in the bytecode and are much cheaper to use which leads to more gas-efficient `price`, `strictPrice` and `refresh` functions. This work-around is necessary since Solidity does not yet support immutable arrays.

### refPerTok

All Curve Pools come with a `get_virtual_price()` function that returns the invariant divided by total supply and is a non-decreasing value. As fees are accrued via swaps, adding liquidity, and removing liquidity, this value would increase.

## Implementation

|     `tok`      |    `ref`     | `target` | `UoA` |
| :------------: | :----------: | :------: | :---: |
| Curve LP Token | CVXCRVSTAKED |   USD    |  USD  |

### refresh

The collateral becomes disabled in the following scenarios:

1. refPerTok() decreases.
2. Collateral has stayed IFFY beyond delayUntilDefault period.

The collateral becomes iffy in the following scenarios:

1. The price feed for any of the tokens is failing.
2. A stablecoin depegs from target peg beyond the default threshold.
3. Ratio of stablecoins within the pool are unbalanced beyond the set pool ratio threshold.

### Deployment

This comes with a template [deploy script](scripts/deploy.ts). It is already fully configured for deployment to Mainnet for the Curve TRI-POOL (DAI, USDC, USDT). You may optionally set `oracleLib` if you want to use existing deployments for OracleLib. The same can be done for `convexStakingWrapper`.

### Setup

For the contracts to compile, run the following:

```
$ npm install
$ npx hardhat compile
```

To run the tests and/or the deployment scripts, a `.env` file is expected with the following environment variables:

- MAINNET_RPC_URL - an RPC URL for ethereum mainnet
- MNEMONIC - mnemonic phrase for the private key
- GOERLI_RPC_URL - an RPC URL for ethereum goerli

Once `.env` is setup and dependencies are installed, tests can be run with: `npx hardhat test` or `npm run test`

### Slither

Below are Slither warnings that were hidden since they were found to be non-issues.

- Hid all issues that were found in dependencies

### Social Media

- Twitter - https://twitter.com/gjaldon
- Discord - gjaldon#9165
