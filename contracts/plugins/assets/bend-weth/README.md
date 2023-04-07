# Collateral Plugin - BENDDAO - bendWETH

## Introduction

BendDAO is a decentralized non-custodial NFT liquidity and lending protocol where users can participate as depositors or borrowers. 
Depositors provide liquidity to the market to earn a passive income, while borrowers are able to borrow in an over-collateralized (perpetually) using NFTs as collateral, or un-collateralized (one-block liquidity) fashion.
It is a fork of Aave protocol, with a few changes to the lending logic and the addition of a new token, 
`bendWETH`. `bendWETH` is a token that is minted upon ETH/WETH deposit to the protocol's lending pool.
If you need to use native ETH in the protocol, it must first be wrapped into WETH. The WETH Gateway contract is a helper contract to easily wrap and unwrap ETH as necessary when interacting with the protocol, since only ERC20 is used within protocol interactions. This enable the protocol to support direct ETH deposits and withdrawals.
bendTokens(etc bendETH) are interest-bearing tokens that are minted and burned upon deposit and withdraw.
It is minted when ETH is deposited and burned when ETH is withdrawn. It is used as collateral for borrowing and as a reward for lending. 
This plugin allows RTokens to utilize [bendWETH](https://github.com/BendDAO/bend-lending-protocol/blob/main/contracts/protocol/BToken.sol) as collateral. 


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
    1. [A - How to mint BendETH](#a---how-to-mint-bendeth)
    2. [B - Calculating the reserve liquidity index](#b---calculating-the-reserve-liquidity-index)
    3. [C - Why is the reserve liquidity index non decreasing?](#c---why-is-the-reserve-liquidity-index-non-decreasing)



## Target Contracts

These are the contracts being used by the plugin:

[Bend WETH Gateway](https://etherscan.io/address/0x3B968D2D299B895A5Fcf3BBa7A64ad0F566e6F88)

[Bend WETH](https://etherscan.io/token/0xed1840223484483c0cb050e6fc344d1ebf0778a9)

[Bend Lend Pool Address Provider](https://etherscan.io/address/0x24451F47CaF13B24f4b5034e1dF6c0E401ec0e46)

[Bend UI Data Provider](https://etherscan.io/address/0x132E3E3eC6652299B235A26D601aa9C68806e3FE)

The addresses of the contracts are also available at the constants.ts file at the plugin test folder.


## Units

| tok  | ref | target | UoA |
| ---- | --- | ------ | --- |
| bendETH | ETH | ETH | USD |


### refPerTok()

Gets the exchange rate for `bendWETH` to `ETH` from BendDAO's Reserve Logic contract using [getSimpleReservesData()](https://github.com/BendDAO/bend-lending-protocol/blob/main/contracts/misc/UiPoolDataProvider.sol#L43) at UiPoolDataProvider.sol. This is the rate used by Bend DAO when converting between bendWETH and ETH.

`bendWETH` will accrue revenue from **lending** into itself by **increasing** the exchange rate of `bendWETH` per `ETH`.


### claimRewards()

There are no rewards to claim from bendETH. The rewards are claimed upon redeeming the bTokens back to ETH by calling the withdrawETH function at the Bend DAO WETH Gateway contract.


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

* Pragma version0.8.17 (contracts/plugins/assets/bend-eth/BendWethCollateral.sol#2) necessitates a version too recent to be trusted. Consider deploying with 0.6.12/0.7.6/0.8.16

* Pragma version0.8.17 (contracts/plugins/assets/bend-eth/IBToken.sol#2) necessitates a version too recent to be trusted. Consider deploying with 0.6.12/0.7.6/0.8.16

* Pragma version0.8.17 (contracts/plugins/assets/bend-eth/IIncentivesController.sol#2) necessitates a version too recent to be trusted. Consider deploying with 0.6.12/0.7.6/0.8.16

* Pragma version0.8.17 (contracts/plugins/assets/bend-eth/ILendPoolAddressesProvider.sol#2) necessitates a version too recent to be trusted. Consider deploying with 0.6.12/0.7.6/0.8.16

* Pragma version0.8.17 (contracts/plugins/assets/bend-eth/IScaledBalanceToken.sol#2) necessitates a version too recent to be trusted. Consider deploying with 0.6.12/0.7.6/0.8.16

* Pragma version0.8.17 (contracts/plugins/assets/bend-eth/IUIPoolDataProvider.sol#2) necessitates a version too recent to be trusted. Consider deploying with 0.6.12/0.7.6/0.8.16

* Pragma version0.8.17 (contracts/plugins/assets/bend-eth/IWETHGateway.sol#2) necessitates a version too recent to be trusted. Consider deploying with 0.6.12/0.7.6/0.8.16


</details>


## Appendix

### A - How to mint BendETH

DepositETH to BendLending through WETHGateway depositETH payable function calls. It will mint bTokens with the following formula:

$$\begin{align}
bTokens = depositAmount * 10^{27} / (index * 10^{27})
\end{align}$$
    
Where the index is the reserve's Liquidity Index and the ref per tok value of the collateral. It is updated every time a deposit | withdraw is made through updateState() calls. 


### B - Calculating the reserve liquidity index

It is calculated by accruing linear interest and multiplying itself with the current liquidity index as follows:

$$\begin{align}
newLiquidityIndex = cumulatedLiquidityInterest * liquidityIndex
\end{align}$$

Where the liquidtyIndex is the current pool's liquidity index and the cumulatedLiquidityInterest is calculated by the following formula:

$$\begin{align}
timeDiff = currentTimestamp - lastUpdateTimestamp
\end{align}$$

$$\begin{align}
cumulatedLiquidityInterest = ((currentLiquidityRate * timeDiff / SecondsPerYear) + 1)
\end{align}$$

Where the currentLiquidityRate is the current liquidity rate of the reserve and the timeDiff is the difference between the current timestamp and the last update timestamp. The SecondsPerYear is a constant value of 31536000.

### C - Why is the reserve liquidity index non decreasing?
When updating indexes after most protocol actions( deposits, withdrawals, borrows and liquidations) , the liquidity index is updated according to the appendix B formula. If there's no income being produced, then the liquidity index will remain the same. However, if there's income being produced, then the liquidity index will increase. This is because the cumulatedLiquidityInterest will be greater than 0.
