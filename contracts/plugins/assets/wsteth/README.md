# stETH Collateral Plugin

## Summary

This plugin allows `wstETH` holders use their tokens as collateral in the Reverse Protocol.

As described in the [Lido Site](https://help.coinbase.com/en/coinbase/trading-and-funding/staking-rewards/cbeth) , `wstETH` is a LSD (Liquid staking derivatives) which enables users to sell or transfer stacked ETH even before withdrawal being enabled.

`wstETH` will accrue revenue from **staking rewards** into itself by **increasing** the exchange rate of the `wstETH` per `stETH`.

You can get exchange rate from [`wstETH.stEthPerToken()`](https://etherscan.io/token/0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0#readContract#F10) method of wstETH contract.

`wstETH` contract: <https://etherscan.io/token/0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0#code>

`stETH` contract: <https://etherscan.io/token/0xae7ab96520de3a18e5e111b5eaab095312d7fe84#code>

As described on `stETH Intro`, `stETH` is a rebasing token which means token balances is not fixed. Due to that, it can not be used directly as collateral the Reverse Protocol. The solution for that is using `wstETH` instead which is not a rebasing token and behaves like `rETH` and `cbETH`.

`wstETH` and `stETH` can be always swapped at any time to each other without any risk and limitation (Except smart contract risk), like `wETH` and `ETH`.

Wrap & Unwrap app can be found here: <https://stake.lido.fi/wrap>

### stETH Intro

> stETH is a ERC20 token that represents ether staked with Lido. Unlike staked ether, it is liquid and can be transferred, traded, or used in DeFi applications. Total supply of stETH reflects amount of ether deposited into protocol combined with staking rewards, minus potential validator penalties. stETH tokens are minted upon ether deposit at **1:1** ratio. When withdrawals from the Beacon chain will be introduced, it will also be possible to redeem ether by burning stETH at the same **1:1** ratio.

_\*from [Lido docs](https://docs.lido.fi/guides/steth-integration-guide/#what-is-steth)_

### wstETH Intro

> Due to the rebasing nature of stETH, the stETH balance on holder's address is not constant, it changes daily as oracle report comes in. Although rebasable tokens are becoming a common thing in DeFi recently, many dApps do not support rebasing. For example, Maker, UniSwap, and SushiSwap are not designed for rebasable tokens. Listing stETH on these apps can result in holders not receiving their daily staking rewards which effectively defeats the benefits of liquid staking. To integrate with such dApps, there's another form of Lido stTokens called wstETH (wrapped staked ether).

> Example:
> You wrap 100 stETH to 99.87 wstETH.
> You continue to earn rewards on your wstETH.
> When you unwrap your wstETH, you receive 101 stETH.

_\*from [Lido docs](https://docs.lido.fi/guides/steth-integration-guide/#wsteth)_

## Economics

Holding `stETH` and `wstETH` has a economic advantage over holding `ETH`, because **Staking Rewards** accumulates into the protocol and causes `wstETH` go up against `ETH`. The mechanism for the `stETH` and `wsETH` is different but because they are interchangeable, in this doc, we only will explain `wstETH`.

Rewards for holding `wstETH` is calculated by an exchange rate:

`1 wstETH = exchange-rate * stETH`

And because 1 `stETH` = 1 `ETH`, then:

`1 wstETH = exchange-rate * stETH`

**Exchange rate is non-decreasing over time, so this rate is a good candidate for `{ref/tok}`.**

### How Exchange rate calculated

```
exchange-rate = totalPooledEther / totalShares
```

`totalShares`: Sum of shares of all account in shares map

`totalPooledEther`: Sum of three types of ether owned by protocol:

- `buffered balance`: ether stored on contract and haven't deposited to official Deposit contract yet.

- `transient balance`: ether submitted to the official Deposit contract but not yet visible in the beacon state.

- `beacon balance`: total amount of ether on validator accounts. This value reported by oracles and makes strongest impact to stETH total supply change.

_\* from https://docs.lido.fi/contracts/lido#rebasing_

## Implementation

### Units

| tok    | ref | target | UoA |
| ------ | --- | ------ | --- |
| wstETH | ETH | ETH    | USD |

### Functions

#### refPerTok {ref/tok}

This function returns rate of `ETH/wstETH`, getting from [stEthPerToken()](https://etherscan.io/token/0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0#readContract#F10) function in wstETH contract.

`stEthPerToken` function returns `stETH/wstETH` rate, and by knowing 1:1 ratio between `stETH` and `ETH`, we can get `ETH/wstETH`.

#### strictPrice() {UoA/tok}

Calculating `{USD/wstETH}` as follow:

```
{USD/wstETH} = {stETH/wstETH} * {USD/stETH}
```

- `stETH/wstETH`: From `refPerTok()`
- `USD/stETH`: From [stETH chainlink feed](https://data.chain.link/ethereum/mainnet/crypto-usd/steth-usd)

#### targetPerRef() {target/ref}

Always returns `1` since `target` and `ref` are both `ETH`.

#### refresh()

This function will check the conditions and update status if needed. Conditions are as below:

- Reference price decrease: This will `default` collateral **immediately** and status became `DISABLED`
- Price of `{USD/wstETH}` falls below/over the reference price +/- `defaultThreshold`: In this condition collateral status become `IFFY`, if status remain in this state for `delayUntilDefault` time, status will change to `DISABLED`
- `strictPrice` reverts: Collateral status becomes `IFFY`
- `pricePerRef` reverts: Collateral status becomes `IFFY`

#### pricePerRef() {UoA/ref}

From `USD/ETH` [chainlink feed](https://data.chain.link/ethereum/mainnet/crypto-usd/eth-usd).

#### pricePerTarget() {UoA/target}

Same as `pricePerRef()`

#### targetName()

returns `ETH`

#### isCollateral()

returns True.

### claimRewards()

Does nothing.

## Deployment

- Deployment [task](../../../../tasks/deployment/collateral/deploy-wsteth-collateral.ts): `yarn hardhat deploy-wsteth-collateral`

  - Params:
    - `fallbackPrice`: A fallback price (in UoA)
    - `ethPriceFeed`: ETH Price Feed address
    - `stethPriceFeed`: StETH Price Feed address
    - `wsteth`: wstETH address
    - `maxTradeVolume`: Max Trade Volume (in UoA)
    - `oracleTimeout`: Max oracle timeout
    - `targetName`: Target Name
    - `defaultThreshold`: Default Threshold
    - `delayUntilDefault`: Delay until default

  Example:

  ```sh
  yarn hardhat deploy-wsteth-collateral \
    --fallback-price 1200000000000000000000 `# 1200$ * 10**18` \
    --eth-price-feed 0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419 \
    --steth-price-feed 0xcfe54b5cd566ab89272946f602d76ea879cab4a8 \
    --wsteth 0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0 \
    --max-trade-volume 1000000 `# 1M$` \
    --oracle-timeout 86400 `# 24H` \
    --target-name 0x4554480000000000000000000000000000000000000000000000000000000000 `# ETH as byte32` \
    --default-threshold 50000000000000000 `# 5% = 0.05 * 10**18` \
    --delay-until-default 86400 # 24H
  ```

- Added to collateral deployment script [2_deploy_collateral.ts](../../../../scripts/deployment/phase2-assets/2_deploy_collateral.ts#610), run with `yarn deploy`.

## Testing

- Integration Test:

  - File: [test/integration/individual-collateral/WstETHCollateral.test.ts](../../../../test/integration/individual-collateral/WstETHCollateral.test.ts)
  - Run: `yarn test:integration`

- Collateral Test:

  - File: [test/plugins/Collateral.test.ts](../../../../test/plugins/Collateral.test.ts)
  - Run: `yarn test:fast`
