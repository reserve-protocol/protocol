# Euler Collateral Plugin

# Overview

This is the implementation of the collateral plug-in of Euler Finance, a permissionless DeFi lending protocol for [Reserve Hackathon](https://gitcoin.co/issue/29509). These plug-ins in `/contracts/plugins/euler` allow Reserve Protocol to create RTokens collateralized by Euler's yield-bearing assets called EToken. <br>

The integration of Euler's ETokens enables RTokens to diversify collateral portfolio and capture more profitable yield sources. <br>

Etokens like eDAI, eUSDC and eUSDT can be backing assets along with yield-bearing assets from other DeFi lending protocols, which could not only bring higher yields but also help reduce the concentrated protocol risks. <br>

Besides those stable assets, wstETH(Wrapped stETH), which is only possible to supply/borrow on Euler among major DeFi lending protocols, is also an excellent collateral type that can generate higher returns than other ETH liquid staking tokens, such as stETH, rETH and cbETH, do because of the additional yield coming from borrowers' interest payment. <br>

Euler is now the third largest lending protocol on Ethereum mainnet following Aave and Compound. Although it hasn't been battled-tested enough and has a relatively smaller TVL compared with those two competitors, given the stability of the protocol and steady growth over the past year, I believe that this is still one of the most reasonable and compelling integrations for Reserve Protocol. <br>

### Links

- [Euler Finance](https://www.euler.finance/) <br>
- [Whitepaper](https://docs.euler.finance/getting-started/white-paper) <br>
- [Github](https://github.com/euler-xyz) <br>
  <br>

# Implementation

## Collateral Assets

EToken is a yield-bearing asset where the conversion rate against the underlying asset always appreciates over time in the same way that cToken in CompoundV2 does. The function `IEToken(eToken).convertBalanceToUnderlying()` returns the exact exchange rate of EToken/Underlying in different decimals that depend on each underlying asset. <br>

Euler Protocol currently has 9 eTokens that are approved by governance to be a collateral asset. The corresponding plug-in implementations for each eToken are below. <br>

- `ETokenFiatCollateral.sol`: eDAI, eUSDC, eUSDT
- `ETokenWSTETHCollateral.sol`: ewstETH
- `ETokenSelfReferentialCollateral.sol`: eWETH, eUNI, eLINK
- `ETokenWBTCCollateral.sol`: eWBTC
  <br>

\*stETH is also a collateral on Euler but it is a rebasing token that isn't compatible with Reserve system and also has almost zero borrow/supply demands. Instead, this implementation only integrates the wrapped version of stETH, wstETH that has the biggest TVL on Euler is available. <br>

### FiatCollateral (eDAI, eUSDC, eUSDT)

| `tok`                    | `ref`                       | `target` | `UoA` |
| ------------------------ | --------------------------- | -------- | ----- |
| Etoken(eDAI/eUSDC/eUSDT) | . underlying(DAI/USDC/USDT) | . USD    | USD   |

`ETokenFiatCollateral.sol`'s code base is almost the same as `CTokenFiatCollateral.sol`.

The fact that all of these eTokens currently provide higher APYs than any c/aTokens do shows that it's very wise to choose them as part of backing for RTokens along with c/aTokens in order to generate bigger profits and diversify the protocol risk brought by smart contract hacks and certain attacks like "highly-profitable trading strategy". <br>

### NonFitCollateral1: ewstETH Collateral

| `tok`   | `ref` | `target` | `UoA` |
| ------- | ----- | -------- | ----- |
| ewstETH | stETH | . ETH    | USD   |

`ETokenWSTETHCollateral.sol` is a collateral that expects `tok`, `ref` and `target` to be ewstETH, stETH and ETH, respectively. Despite the lack of availability of `wstETH/USD` oracle, the combination of `stETH/USD` chainlink feed, `stEthPerToken()`/`getStETHByWstETH()` functions in wstETH contract and `convertBalanceToUnderlying()` in EToken contract makes it possible to figure out wstETH price in USD and hence `strictPrice()` of ewstETH which is calculated by the equation `USD/stETH * stETH/wstETH * wstETH/ewstETH`. <br>

`target` is set to ETH because this ewstETH collateral will most likely be included in RToken baskets along with other Liquid Staking ETH tokens such as wstETH, cbETH, rETH adn frxETH, where `target` is likely to be ETH more than anything else. It's expected that a strong expansion in demand for the basket of these ETH derivatives in the future. <br>

The primary reason that `ref` isn't wstETH, which is `tok`'s underlying asset in Euler, but stETH is that while wstETH price constantly increases against ETH over time, stETH is theoretically supposed to be pegged to ETH. Despite the ongoing de-pegging issue of stETH that effectively makes it unquestionably difficult to ensure that `targetPerRef` is equal to a constant value at this point, thus possibly causing detrimental effects on RTokens that composes ewstETH in some ways, this seems like the most viable and practical approach in the long run, esp after Shanghai Hardfork. <br>

`refresh()` function is designed to trigger soft-default if `ETH/stETH(TargetPerRef)` rate deviates more than threshold(%) from 1:1 peg and hard-default if `refPertok(stETH/ewstETH)` rate ever decreases. Both stETH/wstETH and wstETH/ewstETH are a type of yield-bearing asset that the exchange rate against underlying asset ever-increases. <br>

Currently, [wstETH](https://app.euler.finance/market/0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0) is arguably the most demanded asset on Euler in which apx $120M wstETH is supplied for 5.8% APY(1.1% higher than [the native stETH APY](https://lido.fi/ethereum) ) and $40M is borrowed for 8.16% APY, accounting for nearly half of Euler's TVL. <br>

### NonFitCollateral2: eWBTC Collateral

| tok   | ref  | target | UoA |
| ----- | ---- | ------ | --- |
| eWBTC | WBTC | . BTC  | USD |

`ETokenWBTCCollateral.sol`'s code base is almost the same as `CTokenNonFiatCollateral.sol` where the only example of collateral asset is cWBTC.

### SelfReferentialCollateral (eWETH, eUNI, eLINK)

| `tok`                    | `ref` / `target`                   | `UoA` |
| ------------------------ | ---------------------------------- | ----- |
| Etoken(eWETH/eUNI/eLINK) | eToken's underlying(WETH/UNI/LINK) | USD   |

`ETokenSelfReferentialCollateral.sol`'s code base is almost the same as `CTokenSelfReferentialCollateral.sol`.
<br>

## Technical challenges: Claiming EUL

Euler protocol has its own governance token that can be an additional reward for RToken holders/RSR Stakers. However, unfortunately, it's designed in a way that makes it quite challenging for Reserve Protocol to integrate the functionality of claiming EUL token given the several reasons below. <br>

### 1- No price feed for EUL. <br>

Currently, Chainlink doesn't yet provide any EUL price feed. So I assume that it's impossible to deploy and register EUL as an asset in Reserve system unless either Chainlink deploys EUL price feed or Reserve has a way to fetch the price of EUL from another oracle. <br>

### 2- No EUL Distribution to lenders <br>

Euler protocol doesn’t distribute EUL, Euler’s governance token, to suppliers(lenders) but only to borrowers at this point. <br>

\*Euler DAO has [a future plan](https://snapshot.org/#/eulerdao.eth/proposal/0x7e65ffa930507d9116ebc83663000ade6ff93fc452f437a3e95d755ccc324f93) to incentivize suppliers. We are still not completely sure about how it would look like, but probably it will likely be implemented in a way that EUL is distributed to suppliers who stake EToken to its [EulStake contract](https://github.com/euler-xyz/euler-contracts/blob/master/contracts/mining/EulStakes.sol), instead of directly being allocated to EToken holders.

Hence, it’d be pretty challenging to implement EUL claim functionality for Reserve collateral since `BackingManager.sol` presumably would trigger hard default immediately if it staked its collateral ETokens to an external contract instead of keeping asset balance in the contract. <br>

### 3- Lack of on-chain claimability of EUL Token <br>

`claim()` function in [EulDistributor contract](https://github.com/euler-xyz/euler-contracts/blob/master/contracts/mining/EulDistributor.sol) requires five arguments: `address account, address token, uint claimable, bytes32[] calldata proof, address stake`. <br>

The parameter `proof` is a Merkle proof that can only be retrieved off-chain. Before `claimRewards()` is called, someone must retrieve two data `claimable` and `proof` off-chain first by using [eul-merkle-trees](https://github.com/euler-xyz/eul-merkle-trees), which is repo published by Euler team once a few weeks, and store them into an external contract that collateral contract can call in `claimRewards()` function\*. <br>

Without the latest root hash(stored on-chain) and Merkle proof, it's impossible to claim newly-accrued rewards. <br>

\*it seems like the data shouldn't be stored inside the collateral contract since state variables on the collateral contract can't be read and used via `delegatecall()`. This is why there should be another contract deployed for storing and updating such data. However, this solution could pose a risk in a way that uncarefully stored data can trigger revert when `claimRewards()` is called.

### \*Possible Implementation of EUL Claim

Given the reasons above, EUL claim functionality seems better to be out of the scope of this submission. However, I decided to create a collateral implementation with additional variables and functions and carried out testing for claiming EUL as a possible future implementation. Check: `EulClaimableWSTETH.sol` and `EULClaimableWSTETHCollateral.test.ts`

This is because I'd like to show how EToken collateral contracts would look if EUL claim were possible and I hope it would make it easier for developers in Reserve Community to deploy a new version of EToken collateral contracts that have EUL claim functionality when it ever becomes possible.

## Deployment & Test

test: `yarn test:euler` <br>

### Author

Discord: Porco#3106 <br>
