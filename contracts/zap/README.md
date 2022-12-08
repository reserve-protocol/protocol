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