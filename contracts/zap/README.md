</br>
<p style="text-align: center" align="center">
  <a href="https://badger.com" target="_blank"><img src="https://i.imgur.com/jaz6Tr8.png" width="650" alt="eBTC logo"/></a>
</p>

<div align="center">
  <div align="center">
    <a href="">Example Application</a>
  </div>
  <h6>Powered by Reserve Protocol, Curve, Aave, Compound</h6>
</div>

## Installation

To utilize the repository and run tests against the zap:

```bash
yarn install --frozen-lockfile
npx hardhat test test/zap/Zapper.test.ts
```

## Overview

The Reserve Zap allows for entering any rToken positions supporting a wide array of assets.
These include:

- Most stable coins available on Curve
- WBTC
- WETH
- All Compound v2 markets
- Select Static Aave markets

Positions may enter and redeem to all base ERC20 tokens supported. 

## Summary

The solution implements three main contracts to create a flexible zap framework with no off chain reliance.

- Zapper
- ZapRouter
- ZapRouterAdapater

### Zapper

The zapper is the entry point for the rToken zap.
The goal of the zapper is to take a single input token amount and allow users to enter an rToken position in a single click.
This should reduce the friction to entering an rToken position as currently multiple tokens may be required to utilize a position.

> Scenario 1
> 
> **A user is interested in entering an RSV position. The user has onboarded Ethereum recently, and only owns Ethereum in their wallet.**

The current mint flow for this position:
- Purchase BUSD
- Purchase USDC
- Mint RSV 

This baseline example is not so bad.
RSV, however, is a simple wrapper while the Reserve protocol supports much more flexible options.
Increased complexitty decreases user experience by the nature of the baskets.

> Scenario 2
> 
> **A user is interested in entering an Bogota Token position. The user has onboarded Ethereum recently, and only owns Ethereum in their wallet.**
> 

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
- zapIn utilizing WETH for the Bogota Token

## Extending Reserve Zap

Additional support for other protocols would require adapters for their tokens.
Currently tokens available are limited to those that may be resolved and swapper via the Curve router.
Any routing updates would require a new router to be added for swap implementation.
The new router can be registered with the zap by the Zap Manager.

## Test Results

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