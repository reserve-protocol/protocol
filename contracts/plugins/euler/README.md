# Introduction

This is the implementation of the collateral plug-in of Euler Finance, permissionless DeFi lending protocol for [Reserve Hackathon](https://gitcoin.co/issue/29509). These plug-ins in `/contracts/plugins/euler` allow Reserve Protocol to create RTokens collateralized by Euler's yield-bearing assets called EToken. <br>

The integration of Euler's ETokens enables RTokens to diversify collateral portfolio and capture more profitable yield sources. <br>

Etokens like eDAI, eUSDC and eUSDT can be backing assets along with yield-bearing assets from other DeFi lending protocols, which could not only bring higher yields but also help reduce the concentrated protocol risks. <br>

Besides those stable assets, wstETH(Wrapped stETH) that is only possible to supply/borrow on Euler among major DeFi lending protocols, is also an excellent collateral type that can generate higher returns than other ETH liquid staking tokens, such as stETH, rETH and cbETH, do because of the additional yield coming from borrowers' interest payment. <br>

Euler is now the third largest lending protocol on Ethereum mainnet following Aave and Compound. Although it hasn't been battled-tested enough and has relatively smaller TVL compared with those two competitors, given the stability of the protocol and steady growth over the past year, I believe that this is still one of the most reasonable and compelling integrations for Reserve Protocol. <br>

### Links

[Euler Finance](https://www.euler.finance/) <br>
[Whitepaper](https://docs.euler.finance/getting-started/white-paper) <br>
[Github](https://github.com/euler-xyz) <br>
<br>

# Implementation

## Collateral Assets

EToken is a yield-bearing asset where the conversion rate against underlying asset always appreciates over time in the same way that cToken in CompoundV2 does. The function `IEToken(eToken).convertBalanceToUnderlying()` returns the exact exchange rate of EToken/Underlying in different decimals that depends on each underlying asset. <br>

Euler Protocol currently has 9 eTokens that are permissioned by governance to be collateral asset. The corresponding plug-in implementations for each eToken are below. <br>

- `ETokenFiatCollateral.sol`: eDAI, eUSDC, eUSDT
- `ETokenWSTETHCollateral.sol`: ewstETH
- `ETokenSelfReferentialCollateral.sol`: eWETH, eUNI, eLINK
- `ETokenWBTCCollateral.sol`: eWBTC
  <br>

\*stETH is also a collateral on Euler but it is a rebasing token which isn't compatible with Reserve system and also has almost zero borrow/supply demands. Instead, this implementation only integrates the wrrapped version of stETH, wstETH that has the biggest TVL on Euler is available. <br>

### FiatCollateral (eDAI, eUSDC, eUSDT)

| `tok`                    | `ref`                       | `target` | `UoA` |
| ------------------------ | --------------------------- | -------- | ----- |
| Etoken(eDAI/eUSDC/eUSDT) | . underlying(DAI/USDC/USDT) | . USD    | USD   |

`ETokenFiatCollateral.sol`'s code base is almost the same as `CTokenFiatCollateral.sol`.

The fact that all of these eTokens currently provide higher APYs than any c/aTokens do shows that it's very wise to choose them as part of backing for RTokens along with c/aTokens in order to generate bigger profits and diversify the protocol risk brought by smart contract hacks and certain attacks like "highly-profitable trading strategy". <br>

### NonFitCollateral1: ewstETH Collateral

| `tok`   | `ref`  | `target` | (`underlying`) | `UoA` |
| ------- | ------ | -------- | -------------- | ----- |
| ewstETH | wstETH | . ETH    | . stETH        | USD   |

`ETokenWSTETHCollateral.sol` is a collateral that expects `tok`, `ref` and `target` to be ewstETH, wstETH and ETH respectively. Despite the lack of availability of `wstETH/USD` oracle, the combination of `stETH/USD` chainlink feeds and `stEthPerToken` function in wstETH contract makes it possible to figure out wstETH price in USD and `strictPrice` which is calculated by the euation `USD/stETH * stETH/wstETH * wstETH/ewstETH`. <br>

The primary reason why `target` is neither wstETH nor stETH but ETH is that this ewstETH collateral is expected to be included in the basket along with other Liquid Staking ETH tokens such as wstETH, cbETH, rETH adn frETH, where `target` is likely to be ETH more than anything else. <br>

`refresh()` function is designed to trigger soft-default if `stETH/ETH(target/underlying)` rate deviates >+5% or <-5% and hard-default if either `refPertok(ewstETH/wstETH)` or `underlyingPerRef(stETH/wstETH)` rates ever decreases. <br>

As for soft-default, it doesn't take into account `wstETH/ETH (ref/target)` but `stETH/ETH(underlying/target)` because wstETH whose price(exchange rate against stETH) is ever-increasing can go beyond 5% range at some point in the future while stETH, the underlying token of wstETH, is always expected to be pegged to ETH. <br>

Currently, [wstETH](https://app.euler.finance/market/0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0) is arguably the most demanded asset on Euler in which apx $120M wstETH is supplied for 5.8% APY and $40M is borrowed for 8.16% APY, accounting for nearly half of Euler's TVL. <br>

In the near future, cbETH, Coinbase's liquid staking ETH will also likely be a collateral. With ecbETH and other potential ETH derivative ETokens, RTokens with more yield-amplified backing could be possible to be created. <br>

### NonFitCollateral2: eWBTC Collateral

| tok   | ref  | target | UoA |
| ----- | ---- | ------ | --- |
| eWBTC | WBTC | . BTC  | USD |

`ETokenWBTCCollateral.sol`'s code base is almost the same as `CTokenNonFiatCollateral.sol`.

### SelfReferentialCollateral (eWETH, eUNI, eLINK)

| `tok`                    | `ref` / `target`                   | `UoA` |
| ------------------------ | ---------------------------------- | ----- |
| Etoken(eWETH/eUNI/eLINK) | eToken's underlying(WETH/UNI/LINK) | USD   |

`ETokenSelfReferentialCollateral.sol`'s code base is almost the same as `CTokenSelfReferentialCollateral.sol`.
<br>
<br>

## Technical challenges: Claiming EUL

Euler protocol has its own governance token that can be an additional reward for RToken holders/RSR Stakers. However, unfortunately, it's designed in a way that makes it quite challenging for Reserve Protocol to integrate the functionality of claiming EUL token given the several reasons below. <br>

### 1- No price feed for EUL. <br>

Currently, Chainlink doesn't yet provide any EUL price feed. So it's impossible? to deploy and register EUL as an asset in Reserve system. <br>

### 2- No EUL Distribution to lenders <br>

Euler protocol doesn’t distribute EUL, Euler’s the governance token, to suppliers(lenders) but only borrowers at this point. <br>

\*Euler DAO has [a future plan](https://snapshot.org/#/eulerdao.eth/proposal/0x7e65ffa930507d9116ebc83663000ade6ff93fc452f437a3e95d755ccc324f93) to incentivize suppliers. We are still not completely sure abouw how it will look like, but probably it will likely be implemented in a way that EUL is distributed to suppliers who stake EToken to its EulStake contract, instead of directly being allocated to EToken holders.

Hence, it’d be pretty challenging to implement EUL claim functionality for Reserve collateral since `BackingManager.sol` presumably would trigger hard-default immediately if it staked its collateral ETokens to external contract instead of keeping asset balance in the contract. <br>

### 3- The Lack of onchain claimability of EUL Token <br>

`claim()` function in “EulDistributor” contract requires five arguments: `address account, address token, uint claimable, bytes32[] calldata proof, address stake`. <br>

The parameter `proof` is a merkle proof that can only be retrieved off-chain. Before `claimRewards()` in ETokenFiatCollateral is called, someone must retrieve two data `claimable` and `proof` off-chain first by using [eul-merkle-trees](https://github.com/euler-xyz/eul-merkle-trees), which is repo published by Euler team once a few weeks, and store it into an external contract that collateral contract can call\*. <br>

Without the lastest root hash(stored onchain) and merkle proof, it's impossible to claim newly-accured rewards. <br>

\*it seems like the data shouldn't be stored inside collateral contract since state variables on the colalteral contract can't be read and used via `delegatecall()`. Thus, there should be another contract deployed for storing and updating such data. However, this solution could pose a risk in a way that uncarefully stored data can trigger revert when `claimRewards()` is called.

### \*Possible Implementation of EUL Claim

Given the reasons above, EUL claim functionality seems better to be out of the scope of this submission. However, I decided to create a collateral implementation with additional variables and functions and carried out testing for claiming EUL as a possible future implementation. Check: `EulClaimableWSTETH.sol` and `EULClaimableWSTETHCollateral.test.ts`

This is because I'd like to show how EToken collateral contracts would look like if EUL claim were possible and I hope it would make it easier for developers in Reserve Community to deploy a new version of EToken collateral contracts that have EUL claim functionality when it ever becomes possible.

## Deployment & Test

setup: <br>
`git clone...` <br>
`cd this directory...` <br>
`yarn install` <br>
`yarn prepare` <br>

compile: `yarn compile:euler` <br>
deploy: `yarn deploy:euler` <br>
test: `yarn test:euler` <br>
slither: `yarn slither:euler` <br>

### Author

Discord: Porco#3106 <br>
