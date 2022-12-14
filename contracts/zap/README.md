</br>
  <p style="text-align: center" align="center">
    <a href="https://imzapping.in/#/issuance?token=0xc3ac2836FadAD8076bfB583150447a8629658591" target="_blank"><img src="https://i.imgur.com/e0jwg5i.jpg" width="80%" alt="Reserve Zap Splash"/></a>
  </p>

https://user-images.githubusercontent.com/71284258/207502695-e6e86985-01b9-4b60-91f6-68dcfac2a207.mov

<div align="center">
  <div align="center">
    Demo: <a href="https://imzapping.in/#/issuance?token=0xc3ac2836FadAD8076bfB583150447a8629658591">ImZapping.In</a>
  </div>
  
  <h6>Powered by Reserve Protocol, Curve, Aave, Compound</h6>
</div>

## Installation
To utilize the repository and run tests against the zap (`MAINNET_RPC_URL` must also first be set on `.env`:

```bash
yarn install --frozen-lockfile
npx hardhat test test/zap/Zapper.test.ts
```

## Overview

The Reserve Zap allows for entering/exiting any rToken positions, supporting a wide array of ERC20 assets, including:

- Most stable coins available on Curve
- WBTC
- WETH
- All Compound v2 markets
- Select Static Aave markets

## Demo Usage

A UI supporting the Reserve Zap has been added to the Register frontend at https://github.com/lc-labs/register/pull/3.

The demo at <a href="https://imzapping.in/#/issuance?token=0xc3ac2836FadAD8076bfB583150447a8629658591">ImZapping.In</a> requires connecting to a forked mainnet in MetaMask:
| Variable | Value |
|--------------|------------------------------------------------------|
| Network Name | Forked ETH |
| RPC URL | https://104c-2001-569-7bc0-ff00-2c6f-76a6-dbc9-f8e0.ngrok.io |
| Chain ID | 31337 |
| Symbol | ETH |

Thereafter, the demo can be used to interact with the zap functionality (where all transactions/transfers are inconsequential). When connecting to the app, MetaMask will prompt you to switch back to the ETH network - simply press **cancel** to continue with the demo. Some latency can be expected when running the demo as it relies on connecting to locally running nodes on non-production hardware.

## Motivation

The goal of the zapper is to allow users to enter/exit an rToken position in a single click and with a single token of interest, which significantly reduces the friction to entering and exiting an rToken position. Take for example the following scenarios:

> Scenario 1
>
> **A user is interested in entering an RSV position. The user has onboarded Ethereum recently, and only owns Ethereum in their wallet.**

The current mint flow for this position:

- Purchase BUSD
- Purchase USDC
- Mint RSV

This RSV baseline example is not so bad.
The Reserve Protocol, however, supports much more flexible options, which can result in the user experience becoming increasingly complex.

> Scenario 2
>
> **A user is interested in entering an Bogota Token position. The user has onboarded Ethereum recently, and only owns Ethereum in their wallet.**

The current mint flow for this position:

- Purchase DAI
- Deposit DAI into Compound
- Purchase USDC
- Deposit USDC into Compound
- Purchase USDT
- Deposit USDT into Compound
- Mint RSV

Entering this position can be become inhibitive to user experience for more complex offerings.
Utilizing the Reserve Zap allows for a one click enter into both scenarios above.

> Scenario 3
>
> **A user is interested in entering an Bogota Token position. The user has onboarded Ethereum recently, and only owns Ethereum in their wallet. They utilize the Reserve Zap to enter their position.**

The current mint flow for this position:

- Wrap ETH to WETH
- ⚡ `zapIn` utilizing WETH for the Bogota Token

## Technical Highlights

The solution implements three main contracts to create a flexible zap framework with no off-chain reliance.

- [Zapper.sol](/contracts/zap/Zapper.sol)
  - the external `zapIn` or `zapOut` functions serve as the entry point
  - both invoke the router's `swap` function to make the appropriate conversions
- [ZapRouter.sol](/contracts/zap/ZapRouter.sol)
  - the router is a permissioned contract responsible for handling all swap logic on behalf of the zapper contract
  - the current implementation relies on Curve to perform swaps between input, output, and/or collateral tokens (stablecoins and crypto assets are well supported with deep liquidity)
- [ZapRouterAdapater.sol](/contracts/zap/interfaces/IRouterAdapter.sol)
  - see below

## Extending Reserve Zap

Currently tokens available are limited to those that may be resolved and swapped via the Curve router. However, through zap adaters, there is limitless flexibility to allow for any DeFi legos to be used in the zap framework. Router adapters are contracts that can be registered on the zap router to support activities specific to protocols.

Adapters have been written to provide zap support for all of Reserve Protocol's currently supported collaterals. The provided [Aave](/contracts/zap/StaticAaveRouterAdapter.sol) and [Compound](/contracts/zap/CompoundRouterAdapter.sol) adapters allow for depositing and withdrawing assets to/from these respective protocols. In Aave's case this additionally includes connecting to custom static wrapper contracts

Routing updates require a new router to be registered with the zap router by the Zap Manager.

## Appendix

### Test Results from [Zapper.test.ts](test/zap/Zapper.test.ts)

```
┌─────────┬──────────────────┬─────────────┬──────────────────────────────┬──────────────┬──────────────┬────────────┐
│ (index) │       from       │ tokenAmount │              to              │ rTokenAmount │ redeemAmount │ efficiency │
├─────────┼──────────────────┼─────────────┼──────────────────────────────┼──────────────┼──────────────┼────────────┤
│    0    │  'Wrapped BTC'   │   '0.50'    │           'RToken'           │  '9563.27'   │    '0.50'    │  '99.37%'  │
│    1    │  'Wrapped BTC'   │   '0.50'    │ 'Frictionless auction token' │  '2663.23'   │    '0.50'    │  '99.32%'  │
│    2    │  'Wrapped BTC'   │   '0.50'    │        'Bogota Test'         │  '8134.80'   │    '0.50'    │  '99.27%'  │
│    3    │  'Wrapped BTC'   │   '0.50'    │            'RUSD'            │  '8133.45'   │    '0.50'    │  '99.26%'  │
│    4    │ 'Wrapped Ether'  │   '1.00'    │           'RToken'           │  '1301.94'   │    '0.99'    │  '99.37%'  │
│    5    │ 'Wrapped Ether'  │   '1.00'    │ 'Frictionless auction token' │   '393.08'   │    '0.99'    │  '99.35%'  │
│    6    │ 'Wrapped Ether'  │   '1.00'    │        'Bogota Test'         │  '1200.54'   │    '0.99'    │  '99.28%'  │
│    7    │ 'Wrapped Ether'  │   '1.00'    │            'RUSD'            │  '1200.41'   │    '0.99'    │  '99.26%'  │
│    8    │    'USD Coin'    │ '10000.00'  │           'RToken'           │  '9949.12'   │  '9948.01'   │  '99.48%'  │
│    9    │    'USD Coin'    │ '10000.00'  │ 'Frictionless auction token' │  '3256.13'   │  '9948.01'   │  '99.48%'  │
│   10    │    'USD Coin'    │ '10000.00'  │        'Bogota Test'         │  '9944.48'   │  '9942.77'   │  '99.43%'  │
│   11    │    'USD Coin'    │ '10000.00'  │            'RUSD'            │  '9943.60'   │  '9961.55'   │  '99.62%'  │
│   12    │ 'Dai Stablecoin' │ '10000.00'  │           'RToken'           │  '9950.00'   │  '9962.50'   │  '99.62%'  │
│   13    │ 'Dai Stablecoin' │ '10000.00'  │ 'Frictionless auction token' │  '3256.43'   │  '9975.00'   │  '99.75%'  │
│   14    │ 'Dai Stablecoin' │ '10000.00'  │        'Bogota Test'         │  '9945.38'   │  '9943.77'   │  '99.44%'  │
│   15    │ 'Dai Stablecoin' │ '10000.00'  │            'RUSD'            │  '9944.50'   │  '9959.07'   │  '99.59%'  │
│   16    │   'Tether USD'   │ '10000.00'  │           'RToken'           │  '9949.32'   │  '9948.01'   │  '99.48%'  │
│   17    │   'Tether USD'   │ '10000.00'  │ 'Frictionless auction token' │  '3255.14'   │  '9950.08'   │  '99.50%'  │
│   18    │   'Tether USD'   │ '10000.00'  │        'Bogota Test'         │  '9941.44'   │  '9944.10'   │  '99.44%'  │
│   19    │   'Tether USD'   │ '10000.00'  │            'RUSD'            │  '9940.56'   │  '9943.11'   │  '99.43%'  │
│   20    │  'Binance USD'   │ '10000.00'  │           'RToken'           │  '9945.67'   │  '9941.99'   │  '99.42%'  │
│   21    │  'Binance USD'   │ '10000.00'  │ 'Frictionless auction token' │  '3254.67'   │  '9942.85'   │  '99.43%'  │
│   22    │  'Binance USD'   │ '10000.00'  │        'Bogota Test'         │  '9940.02'   │  '9936.45'   │  '99.36%'  │
│   23    │  'Binance USD'   │ '10000.00'  │            'RUSD'            │  '9939.14'   │  '9958.52'   │  '99.59%'  │
│   24    │      'Frax'      │ '10000.00'  │           'RToken'           │  '9941.71'   │  '9941.06'   │  '99.41%'  │
│   25    │      'Frax'      │ '10000.00'  │ 'Frictionless auction token' │  '3254.17'   │  '9940.95'   │  '99.41%'  │
│   26    │      'Frax'      │ '10000.00'  │        'Bogota Test'         │  '9938.49'   │  '9937.86'   │  '99.38%'  │
│   27    │      'Frax'      │ '10000.00'  │            'RUSD'            │  '9935.90'   │  '9938.75'   │  '99.39%'  │
└─────────┴──────────────────┴─────────────┴──────────────────────────────┴──────────────┴──────────────┴────────────┘
```
