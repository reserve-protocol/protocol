# Bancor V3 Collateral Plugin

Bancor is a decentralized network of on-chain automated market makers (AMMs) supporting instant, low-cost trading, as well as Single-Sided Liquidity Provision and Liquidity Protection for any listed token.

With bancor there is a possibility to earn interest by providing liquidity with Single-Sided Staking.

## What are the collateral token, reference unit, and target unit for this plugin?

For Fiat collateral plugin:

`tok`: bnDai  
`ref`: DAI  
`target`: USD  
`UoA`: USD

For Non-Fiat collateral plugin:

`tok`: bnETH  
`ref`: ETH  
`target`: ETH  
`UoA`: USD

## How does one configure and deploy an instance of the plugin?

BLOCK USED IN TEST: `15000000`

The collateral plugin `BancorV3FiatCollateral` is the plugin that will be deployed for any Fiat `bnToken` pool.
Currently only `bnDai` token pool is available from Bancor V3 pools. 

### Requirements for `bnDai` pool

fallbackPrice: `1000000000000000000`
chainlinkFeed: a Chainlink price feed for DAI: `0xAed0c38402a5d19df6E4c03F4E2DceD6e29c1ee9`
erc20collateral: Address of `bnDai` toke: `0x06CD589760Da4616a0606da1367855808196C352`
targetName: `USD`
bancorProxy: an Address of Bancor Network Info V3 contract: `0x8E303D296851B320e6a697bAcB979d13c9D6E760`
rewardsProxy: an Address of StandardRewards contract: `0xb0B958398ABB0b5DB4ce4d7598Fb868f5A00f372`
autoProcessRewardsProxy: an Address of AutoCompoundingRewards contract:`0x036f8B31D78ca354Ada40dbd117e54F78B6f6CDc`

### Requirements for `bnETH` pool
fallbackPrice: `1000000000000000000`
chainlinkFeed: a Chainlink price feed for ETH: `0xAed0c38402a5d19df6E4c03F4E2DceD6e29c1ee9`
erc20collateral: Address of `bnETH` toke: `0x06CD589760Da4616a0606da1367855808196C352`
targetName: `ETH`
bancorProxy: an Address of Bancor Network Info V3 contract: `0x8E303D296851B320e6a697bAcB979d13c9D6E760`
rewardsProxy: an Address of StandardRewards contract: `0xb0B958398ABB0b5DB4ce4d7598Fb868f5A00f372`
autoProcessRewardsProxy: an Address of AutoCompoundingRewards contract:`0x036f8B31D78ca354Ada40dbd117e54F78B6f6CDc`

## Why should the value (reference units per collateral token) decrease only in exceptional circumstances?

The reference units per collateral token is a function of the ratio between the `bnTokens` and the staked amount + fees. RefperTok() value is being constantly increased by trades, each trade collects fees that are beind added to the value. 

Because the refPerTok() value can be only increased by trading fees, It couldn't be increased by 'just moving' TIME and BLOCKS of forked mainnet in the tests. The way to make the test work there are two possibilities:
1. Emulate trades on forked mainnet
2. Fork different blocks, with changed refPerTok value by the trading fees on mainnet

Second option is the one used in the test, the amounts of refPerTok on different fork blocks were hardcoded into the test to display its ever-increasing value.

In the case were the reference per token ratio decreases for some liquidity exploits, the plugin will default.

## How does the plugin guarantee that its status() becomes DISABLED in those circumstances?

The plugin monitors the reference units per collateral token ratio, if there is a drawdown the plugin will default instantly. 


