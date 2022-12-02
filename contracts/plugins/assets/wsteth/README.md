# stETH Collateral Plugin

## 1. Summury

This pluging allows `wstETH` and `stETH` holders use their tokens as collateral in the Reverse Protocol.

As descriebed in the [Lido Site](https://help.coinbase.com/en/coinbase/trading-and-funding/staking-rewards/cbeth) , `wstETH` is a LSD (Liquid staking derivatives) which enables users to sell or transfer stacked ETH even before withdrawal being enabled.

`wstETH` will accure revenue from **staking rewards** into itself by **incerasing** the exchange rate of the `wstETH` per `ETH`.

You can get exchange rate from [Coinbase API](https://docs.cloud.coinbase.com/exchange/reference/exchangerestapi_getwrappedassetconversionrate) or [directly on chain](https://etherscan.io/token/0xbe9895146f7af43049ca1c1ae358b0541ea49704#readProxyContract#F12).

`cbETH` contract: https://etherscan.io/token/0xbe9895146f7af43049ca1c1ae358b0541ea49704

## 2. stETH Intro

```
stETH is a ERC20 token that represents ether staked with Lido. Unlike staked ether, it is liquid and can be transferred, traded, or used in DeFi applications. Total supply of stETH reflects amount of ether deposited into protocol combined with staking rewards, minus potential validator penalties. stETH tokens are minted upon ether deposit at 1:1 ratio. When withdrawals from the Beacon chain will be introduced, it will also be possible to redeem ether by burning stETH at the same 1:1 ratio.
```

_\*from [Lido docs](https://docs.lido.fi/guides/steth-integration-guide/#what-is-steth)_

## 3. wstETH Intro

```
Due to the rebasing nature of stETH, the stETH balance on holder's address is not constant, it changes daily as oracle report comes in. Although rebasable tokens are becoming a common thing in DeFi recently, many dApps do not support rebasing. For example, Maker, UniSwap, and SushiSwap are not designed for rebasable tokens. Listing stETH on these apps can result in holders not receiving their daily staking rewards which effectively defeats the benefits of liquid staking. To integrate with such dApps, there's another form of Lido stTokens called wstETH (wrapped staked ether).

Example:
You wrap 100 stETH to 99.87 wstETH.
You continue to earn rewards on your wstETH.
When you unwrap your wstETH, you receive 101 stETH.
```

_\*from [Lido docs](https://docs.lido.fi/guides/steth-integration-guide/#wsteth)_

## 3. Implementation

### 3.1 Units

| tok    | ref   | target | UoA |
| ------ | ----- | ------ | --- |
| wstETH | stETH | ETH    | USD |

### 3.2 Functions

#### refPerTok {ref/tok}

This function calculates rate of `ETH/cbETH` using `price()` function for `cbETH/USD` and [`ETH/USD` chainlink feed](https://data.chain.link/ethereum/mainnet/crypto-usd/eth-usd) for `ETH/USD`.

#### price() {UoA/tok}

Using [`cbETH` chainlink feed](https://data.chain.link/ethereum/mainnet/crypto-usd/cbeth-usd) to get the price.

#### strictPrice() {UoA/tok}

same as `price()`, except it will revert if pricing data is unavailable.

#### targetPerRef() {target/ref}

Always returns `1` since `target` and `ref` are both `ETH`.

#### refresh

#### targetName()

returns `USD`

## 4 Deployment

TODO
