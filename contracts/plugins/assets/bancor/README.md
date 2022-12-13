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

`tok`: bnBNT  
`ref`: BNT  
`target`: BNT  
`UoA`: USD

`tok`: bnLINK  
`ref`: LINK   
`target`: LINK   
`UoA`: USD

## How does one configure and deploy an instance of the plugin?

FORK BLOCK USED IN TESTS: `15000000`

The collateral plugin `BancorV3FiatCollateral` is the plugin that will be deployed for any Fiat `bnToken` pool.

The collateral plugin `BancorV3NonFiatCollateral` is the plugin that will be deployed for any Non-Fiat `bnToken` pool.

### Global Requirements for all the pools:

bancorProxy: an Address of Bancor Network Info V3 contract: `0x8E303D296851B320e6a697bAcB979d13c9D6E760`
rewardsProxy: an Address of StandardRewards contract: `0xb0B958398ABB0b5DB4ce4d7598Fb868f5A00f372`
autoProcessRewardsProxy: an Address of AutoCompoundingRewards contract:`0x036f8B31D78ca354Ada40dbd117e54F78B6f6CDc`

### Requirements for `bnDai` pool
fallbackPrice: `1000000000000000000`
chainlinkFeed: a Chainlink price feed for DAI: `0xAed0c38402a5d19df6E4c03F4E2DceD6e29c1ee9`
erc20collateral: Address of `bnDai` token: `0x06CD589760Da4616a0606da1367855808196C352`
targetName: `USD`

### Requirements for `bnETH` pool
fallbackPrice: `1123214985732310979533`
chainlinkFeed: a Chainlink price feed for ETH: `0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419`
erc20collateral: Address of `bnETH` token: `0x256Ed1d83E3e4EfDda977389A5389C3433137DDA`
targetName: `ETH`

### Requirements for `bnBNT` pool
fallbackPrice: `516070475404423204`
chainlinkFeed: a Chainlink price feed for BNT: `0x1e6cf0d433de4fe882a437abc654f58e1e78548c`
erc20collateral: Address of `bnBNT` token: `0xAB05Cf7C6c3a288cd36326e4f7b8600e7268E344`
targetName: `BNT`

### Requirements for `bnLINK` pool
fallbackPrice: `6983802798135870444`
chainlinkFeed: a Chainlink price feed for LINK: `0x2c1d072e956affc0d435cb7ac38ef18d24d9127c`
erc20collateral: Address of `bnLINK` token: `0x516c164A879892A156920A215855C3416616C46E`
targetName: `BNT`

## Why should the value (reference units per collateral token) decrease only in exceptional circumstances?

The reference units per collateral token is a function of the ratio between the `bnTokens` and the staked amount + fees. RefperTok() value is being constantly increased by trades, each trade collects fees that are beind added to the value. 

Because the refPerTok() value can be only increased by trading fees, It couldn't be increased by 'just moving' TIME and BLOCKS of forked mainnet in the tests. The way to make the test work there are two possibilities:
1. Emulate trades on forked mainnet
2. Fork different blocks, with changed refPerTok value by the trading fees on mainnet

Second option is the one used in the test, the amounts of refPerTok on different fork blocks were hardcoded into the test to display its ever-increasing value.

In the case were the reference per token ratio decreases for some liquidity exploits, the plugin will default.

## How does the plugin guarantee that its status() becomes DISABLED in those circumstances?

The plugin monitors the reference units per collateral token ratio, if there is a drawdown the plugin will default instantly. 


