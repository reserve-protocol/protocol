# Collateral Plugin - Maker Earn - 50x Uni Pools - GUNIV3DAIUSDC1 | GUNIV3DAIUSDC2

## Introduction

G-UNI Multiply is a feature that allows you to earn Uniswap V3 trading fees with your Dai. G-UNIV3DAIUSDC is a collateral type that represents a fungible version of a Uniswap V3 DAI/USDC position trading in a very tight range. Using this as collateral to generate DAI users can multiply their position allowing them to collect the fees earned from being a liquidity provider in Uniswap V3 with high capital efficiency.
The G-UNI DAI/USDC LP pair is a collateral in the Maker Protocol that’s a ECR20 tokenization of a Uniswap V3 position. Arrakis Finance (formerly Gelato.network) has created a wrapped version of Uniswap V3 positions, where they make sure to reinvest the earned fees. GUNIV3DAIUSDC is the name of the Vault of a Uniswap V3 position that provides liquidity for DAI and USDC at fixed spread. 

GUNIV3DAIUSDC-A represents a Uniswap V3 position with a spread of 0.9994 - 1.0014 at a 0.05% fee.
GUNIV3DAIUSDC2-A represents a Uniswap V3 position with a spread of 0.9998 - 1.0002 at a 0.01% fee.

Oasis.app Multiply takes this collateral and uses it to generate Dai up to the maximum collateralization ratio possible to collect the most fees from trading activity. Each G-UNI Vault has a different collateralization ratio and stability fee. However these values are low allowing users to  deposit Dai in their prefered G-UNI Vault and with just one transaction they get up to 50x multiple to collect up to 50x trading fees depending on the Vault chosen.

It is a fork of Aave protocol, with a few changes to the lending logic and the addition of a new token, 
`bendWETH`. `bendWETH` is a token that is minted upon ETH/WETH deposit to the protocol's lending pool.
If you need to use native ETH in the protocol, it must first be wrapped into WETH. The WETH Gateway contract is a helper contract to easily wrap and unwrap ETH as necessary when interacting with the protocol, since only ERC20 is used within protocol interactions. This enable the protocol to support direct ETH deposits and withdrawals.
bendTokens(etc bendETH) are interest-bearing tokens that are minted and burned upon deposit and withdraw.
It is minted when ETH is deposited and burned when ETH is withdrawn. It is used as collateral for borrowing and as a reward for lending. 
This plugin allows RTokens to utilize [GUNIDAIV3 tokens](https://etherscan.io/address/0xb542d5cb34ef265fb87c170181127332f7797369#code) as collateral. 


## Table of Contents

1. [Introduction](#introduction)
2. [Table of Contents](#table-of-contents)
3. [Target Contracts](#target-contracts)
4. [Units](#units)
    1. [refPerTok()](#refpertok)
    2. [claimRewards()](#claimrewards)
5. [Tests](#tests)
    1. [Unit Tests](#unit-tests)
    2. [Static Analysis](#static-analysis)
6. [Appendix](#appendix)
    1. [A - Increase ref per tok test doesn't pass](#a---increase-ref-per-tok-test-doesnt-pass)



## Target Contracts

These are the contracts being used by the plugin:

[MCD Vat](https://etherscan.io/address/0x35D1b3F3D7966A1DFe207aa4514C12a259A0492B)

[MCD Gem Join GUNIV3DAIUSDC1](https://etherscan.io/address/0xbFD445A97e7459b0eBb34cfbd3245750Dba4d7a4)

[MCD Gem Join GUNIV3DAIUSDC2](https://etherscan.io/address/0xA7e4dDde3cBcEf122851A7C8F7A55f23c0Daf335)

[GUNIV3DAIUSDC1](https://etherscan.io/address/0xAbDDAfB225e10B90D798bB8A886238Fb835e2053)

[GUNIV3DAIUSDC2](https://etherscan.io/address/0x50379f632ca68D36E50cfBC8F78fe16bd1499d1e)


The addresses of the contracts are also available at the constants.ts file at the plugin test folder.


## Units

| tok  | ref | target | UoA |
| ---- | --- | ------ | --- |
| GUNIV3DAIUSDC1 | DAI/USDC | DAI/USDC | USD |
| GUNIV3DAIUSDC2 | DAI/USDC | DAI/USDC | USD |


### refPerTok()

Gets the exchange rate for `GUNIV3DAIUSDC1` | `GUNIV3DAIUSDC2` to `DAI/USCD` from MCD Vault's contract passing the collateral ilk (a bytes32 pool identifier) at ilks(), a function at [Maker: MCD VAT](https://etherscan.io/address/0x35D1b3F3D7966A1DFe207aa4514C12a259A0492B#code). 
This is a non-decreasing rate that represents: collateral price with safety margin, i.e. the maximum stablecoin allowed per unit of collateral [Vat detailed documentation](https://docs.makerdao.com/smart-contract-modules/core-module/vat-detailed-documentation).

`GUNIV3DAIUSDC1` | `GUNIV3DAIUSDC2` will accrue revenue as a Liquidity Pool Token by **increasing** it's exchange rates.


### claimRewards()

There are no rewards to claim DIRECTLY from GUNIV3DAIUSDC tokens. The rewards are claimed upon redeeming the LP tokens back to the underlying assets removing liquidity from the pool.

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

* Pragma version0.8.17 (contracts/plugins/assets/maker/GUniV3Collateral.sol#2) necessitates a version too recent to be trusted. Consider deploying with 0.6.12/0.7.6/0.8.16

* GUniLPOracle (contracts/plugins/assets/maker/GUniLPOracle.sol#72-352) should inherit from OracleLike (contracts/plugins/assets/maker/GUniLPOracle.sol#68-70)
Reference: https://github.com/crytic/slither/wiki/Detector-Documentation#missing-inheritance

* GUniLPOracle.WAD (contracts/plugins/assets/maker/GUniLPOracle.sol#115) is never used in GUniLPOracle (contracts/plugins/assets/maker/GUniLPOracle.sol#72-352)
Reference: https://github.com/crytic/slither/wiki/Detector-Documentation#unused-state-variable

* Variable GUniLPOracle.TO_18_DEC_0 (contracts/plugins/assets/maker/GUniLPOracle.sol#108) is too similar to GUniLPOracle.TO_18_DEC_1 (contracts/plugins/assets/maker/GUniLPOracle.sol#109)
Reference: https://github.com/crytic/slither/wiki/Detector-Documentation#variable-names-too-similar

* GUniLPOracle.sqrt(uint256) (contracts/plugins/assets/maker/GUniLPOracle.sol#131-153) uses literals with too many digits:
        - xx >= 0x100000000000000000000000000000000 (contracts/plugins/assets/maker/GUniLPOracle.sol#136)

* GUniLPOracle.sqrt(uint256) (contracts/plugins/assets/maker/GUniLPOracle.sol#131-153) uses literals with too many digits:
        - xx >= 0x10000000000000000 (contracts/plugins/assets/maker/GUniLPOracle.sol#137)

* GUniLPOracle.sqrt(uint256) (contracts/plugins/assets/maker/GUniLPOracle.sol#131-153) uses literals with too many digits:
        - xx >= 0x100000000 (contracts/plugins/assets/maker/GUniLPOracle.sol#138)

* Reference: https://github.com/crytic/slither/wiki/Detector-Documentation#too-many-digits


</details>

## Wrapper token
Oasis/Maker Earn GUNI positions work by locking LP tokens to a vault in a process called staking. However, there's no deterministic way to find the amount of each user's LP tokens deposited if a deposit always goes through a single vault. By minting Wrapper Tokens in a 1:1 ratio to deposited LPT, it enables transferrable staked positions and easy balances management (by minting upon deposit and burning upon withdraws).

The tests for this Wrapper Token do not cover permission management nor token details.

## Appendix

### A - Increase ref per tok test doesn't pass
The ref per tok value increases after liquidity is provided AND a a update is triggered by trusted oracles. This update requires a minimum hop of 3600 seconds in order to increase the validity and protect the pool from price manipulation.
The oracle price increasing functionality is not finished yet, but I've built a POC that illustrates the concept. 

The collateral's refresh function works as shown by tests. 
To illustrate a ref per tok increase, notice the following transaction that adds liquidity to the pool at block 15893518. It removes underlying tokens from [Uniswap V3: DAI-USDC LP](https://etherscan.io/address/0x6c6bc977e13df9b0de53b251522280bb72383700), sends it to [Arrakis: DAI-USDC LP](https://etherscan.io/address/0xabddafb225e10b90d798bb8a886238fb835e2053) that sends it back to Uniswap's LP, acting as a position wrapper. Tx: [0xe1cf3475817b2b76e4637c3bd9849ecc045665f7d52b978de2d1f2f734493fc6](https://etherscan.io/tx/0xe1cf3475817b2b76e4637c3bd9849ecc045665f7d52b978de2d1f2f734493fc6)

After approximately 3600 seconds, the oracle updates the rates and the ref per tok increases. This can be confirmed by querying if via the fork in two different blocks:  15893800 and 15893900

The results are shown at the following table:

| Fork Block  | Ref Per Tok  |
| ---- | --- |
| 15893800 | 1000684224597560041601 |
| 15893900 | 1000685620202952463030 |