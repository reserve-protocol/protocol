# Collateral Plugin - GearBox - Lending Pools

## Introduction

Most of the information below is taken from the [Gearbox documentation](https://docs.gearbox.finance/)

Gearbox is a generalized leverage protocol. It has two sides to it: passive liquidity providers who earn low-risk APY by providing single-asset liquidity; and active farmers, firms, or even other protocols who borrow those assets to trade or farm with even x10 leverage.

This plugin is aimed at Gearbox liquidity providers: who seek passive yield and prefer lower risks. This can be seen similar to providing liquidity to Compound and getting cTokens back. LPs' assets are utilized by others, for which they get APY. Any one can be a liquidity provider on Gearbox.

When you supply capital to a pool, you get Diesel Tokens, also known as dTokens, back. These tokens automatically earn interest & fees proportional to your share of the pool like cTokens on Compound or Yearn LP tokens. You don’t need to claim interest or perform any other actions, your Diesel Tokens grow in value. This is if the pool doesn't suffer losses from incorrect liquidations.


This plugin allows RTokens to utilize [dTokens](https://github.com/Gearbox-protocol/core-v2/blob/main/contracts/tokens/DieselToken.sol) as collateral. 


## Table of Contents

1. [Introduction](#introduction)
2. [Table of Contents](#table-of-contents)
3. [Target Contracts](#target-contracts)
4. [Units](#units)
    * [refPerTok()](#refpertok)
    * [claimRewards()](#claimrewards)
5. [Tests](#tests)
    * [Unit Tests](#unit-tests)
    * [Static Analysis](#static-analysis)
6. [Appendix](#appendix)
    * [A - Warnings](#a---warnings)
    * [B - Why is a dToken value considered to be non decreasing?](#b---why-is-a-dtoken-value-considered-to-be-non-decreasing)



## Target Contracts

These are the contracts being used by the plugin:

| dToken | ref | GearBox Pool Service | Chainlink Price Feed |
| ------ | --- | ------------ | -------------------- |
| [dWETH](https://etherscan.io/address/0xf21fc650c1b34eb0fde786d52d23da99db3d6278) | [WETH](https://etherscan.io/token/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2) | [WETH Pool Service](https://etherscan.io/address/0xb03670c20f87f2169a7c4ebe35746007e9575901) | [ETH/USD Chainlink Price Feed](https://etherscan.io/address/0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419) |
| [dDAI](https://etherscan.io/address/0x6cfaf95457d7688022fc53e7abe052ef8dfbbdba) | [DAI](https://etherscan.io/token/0x6b175474e89094c44da98b954eedeac495271d0f) | [DAI Pool Service](https://etherscan.io/address/0x24946bcbbd028d5abb62ad9b635eb1b1a67af668) | [DAI/USD Chainlink Price Feed](https://etherscan.io/address/0xaed0c38402a5d19df6e4c03f4e2dced6e29c1ee9) |
| [dUSDC](https://etherscan.io/address/0xc411db5f5eb3f7d552f9b8454b2d74097ccde6e3) | [USDC](https://etherscan.io/token/0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48) | [USDC Pool Service](https://etherscan.io/address/0x86130bdd69143d8a4e5fc50bf4323d48049e98e4) | [USDC/USD Chainlink Price Feed](https://etherscan.io/address/0x8fffffd4afb6115b954bd326cbe7b4ba576818f6) |
| [dFRAX](https://etherscan.io/address/0xe753260f1955e8678dcea8887759e07aa57e8c54) | [FRAX](https://etherscan.io/token/0x853d955acef822db058eb8505911ed77f175b99e) | [FRAX Pool Service](https://etherscan.io/address/0xb2a015c71c17bcac6af36645dead8c572ba08a08) | [FRAX/USD Chainlink Price Feed](https://etherscan.io/address/0xb9e1e3a9feff48998e45fa90847ed4d467e8bcfd) |

The addresses of the contracts are also available at the constants.ts file at the plugin test folder.


## Units

| tok  | ref | target | UoA |
| ---- | --- | ------ | --- |
| dWETH | WETH | ETH | USD |
| dDAI | DAI | DAI | USD |
| dUSDC | USDC | USDC | USD |
| dFRAX | FRAX | FRAX | USD |


### refPerTok()

Gets the exchange rate between the reference token and the dToken. GearBox offers two functions to get the exchange rate between the reference token and the dToken. 
The first one is the fromDiesel function, which is used to get an amount of ref token from certain amount of dTokens picked by the caller. 
I've opted to hardcode the call value as 1e18, so it represents one whole unit of most coins. 
The second one is the toDiesel function, which is used to get an amount of dTokens from certain amount of ref tokens.

```solidity
    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function _underlyingRefPerTok() internal view override returns (uint192) {
       
        return _safeWrap(poolService.fromDiesel(1e18));
    }
```

### claimRewards()

There are no rewards to claim from GearBox liquidity pools. The rewards are claimed upon redeeming the LP tokens back to the reference token by calling the removeLiquidity function at the Pool Service contract.


## Tests

### Unit Tests

The Test suite is located at the `test` directory, inside the plugins/individual-collateral/bend-eth directory and is adapted to run by using the following command, similarly to other individual-collateral plugins:

```bash
    yarn test:plugins:integration
```


### Static Analysis

Static analysis was performed by using slither with the following command:
    
```bash
    yarn slither
```

The results of the analysis for this plugin can be replicated by running the same command from the root directory of the project.

<details>

<summary>Findings</summary>

Severity: High

* None

Severity: Medium

* None

Severity: Low

* None

Severity: Informational

ragma version0.8.17 (contracts/plugins/assets/gearbox/GearBoxFiatCollateral.sol#2) necessitates a version too recent to be trusted. Consider deploying with 0.6.12/0.7.6/0.8.16

Pragma version0.8.17 (contracts/plugins/assets/gearbox/GearBoxNonFiatCollateral.sol#2) necessitates a version too recent to be trusted. Consider deploying with 0.6.12/0.7.6/0.8.16

* Pragma version^0.8.10 (contracts/plugins/assets/gearbox/core/AddressProvider.sol#4) allows old versions

* Pragma version^0.8.10 (contracts/plugins/assets/gearbox/core/access/Claimable.sol#4) allows old versions

* Pragma version^0.8.10 (contracts/plugins/assets/gearbox/interfaces/IAddressProvider.sol#4) allows old versions

* Pragma version^0.8.10 (contracts/plugins/assets/gearbox/interfaces/IDieselToken.sol#4) allows old versions

* Pragma version^0.8.10 (contracts/plugins/assets/gearbox/interfaces/IPoolService.sol#4) allows old versions

* Pragma version^0.8.10 (contracts/plugins/assets/gearbox/interfaces/IVersion.sol#4) allows old versions

* Pragma version^0.8.10 (contracts/plugins/assets/gearbox/libraries/Errors.sol#4) allows old versions



</details>


## Appendix

### A - Warnings

* Mind USDC uses 6 decimals, while the other tokens use 18. This does not affect the deployment of the plugin, but it is important to keep in mind when testing and putting the plugin into production.

* collateralTests.ts is not being used in the test suite, it required tests that were too precise to the current implementation of getter functions. The adapted file is gearBoxCollateralTests.ts.

### B - Why is a dToken value considered to be non decreasing?
According to GearBox's documentation, the only way to decrease the value of a dToken is from incorrect liquidations losses. 
At [Gearbox Liquidations](https://dune.com/queries/1463354/2476721), all liquidations so far have been profitable for the liquidator and the liquidated dToken has not decreased in value, hence the good status of the liquidations.
