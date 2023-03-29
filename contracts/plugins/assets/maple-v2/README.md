# Maple Finance Permissionless Pools Collateral Plugin

## Introduction

[Maple Finance][maple-docs-overview] is a DeFi protocol providing capital to institutional borrowers through globally accessible fixed-income yield opportunities.

Participants in the liquidity pools deposit assets and receive LP tokens in return.
The value of the LP tokens accrues every block with the interests collected from loans on the liquidity gathered.

In the end the tokens are redeemable for the underlying assets at the exchange rate of the time, which is designed to always increase.

The collateral covers the Maven 11 permissionless pools:

- [a pool of USD][maple-app-usd-pool]
- [and another pool of wETH][maple-app-weth-pool]

## Deployment

### Scripts

The deployment of the Maple Pool collaterals is automated with a script for each pool:

- [Maven 11 USDC][reserve-collateral-usdc-deployment-script]
- [Maven 11 wETH][reserve-collateral-weth-deployment-script]

### Parameters

For the USD pool:

```solidity
struct CollateralConfig {
    uint48 priceTimeout; // 604800 {s} (1 week)
    AggregatorV3Interface chainlinkFeed; // "0x8fffffd4afb6115b954bd326cbe7b4ba576818f6" {USDC/USD}
    uint192 oracleError; // 0.0025 {1}
    IERC20Metadata erc20; // "0xd3cd37a7299B963bbc69592e5Ba933388f70dc88"
    uint192 maxTradeVolume; // 1e6 {UoA}
    uint48 oracleTimeout; // 86400 {s} (24h)
    bytes32 targetName; // "USD"
    uint192 defaultThreshold; // 0.05 {1}
    uint48 delayUntilDefault; // 86400 {s} (24h)
}
uint192 revenueHiding; // 1e-6 allowed drop, as a ratio of the refPerTok 
```

For the wETH pool:

```solidity
struct CollateralConfig {
    uint48 priceTimeout; // 604800 {s} (1 week)
    AggregatorV3Interface chainlinkFeed; // "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419" {ETH/USD}
    uint192 oracleError; // 0.005 {1}
    IERC20Metadata erc20; // "0xFfF9A1CAf78b2e5b0A49355a8637EA78b43fB6c3
    uint192 maxTradeVolume; // 1e6 {UoA}
    uint48 oracleTimeout; // 3600 {s} (1h)
    bytes32 targetName; // "USD"
    uint192 defaultThreshold; // 0.15 {1}
    uint48 delayUntilDefault; // 86400 {s} (24h)
}
uint192 revenueHiding; // 1e-6 allowed drop, as a ratio of the refPerTok 
```

## Pool Accounting

Maple has a thorough documentation; here we're interested in the [pool's logic][maple-docs-pools].

### Units

Maven11 USDC Pool Contracts:

| `tok` | `ref` | `tgt` | `UoA` |
| :---: | :---: | :---: | :---: |
|  LPT  | USDC  |  USD  |  USD  |

Maven11 WETH Pool Contracts:

| `tok` | `ref` | `tgt` | `UoA` |
| :---: | :---: | :---: | :---: |
|  LPT  | wETH  |  USD  |  USD  |

The tokens / shares given to liquidity providers in return for their assets are not named.
Here I called it "LPT", for "liquidity provider token".

It is different from the MPL / xMPL tokens.

### Exchange Rate Calculation (refPerTok)

The calculation is straightforward and [well documented][maple-docs-exchange-rate]:

$$\begin{align}
exchangeRate = \frac{totalAssets}{totalSupply}
\end{align}$$

Where the `exchangeRate` is actually `refPerTok`.
It is implemented by the pool contract [`convertToAssets][maple-code-pool-contract-converttoassets].

The `totalAssets` take the accrued interests and past losses into account.

### Conditions of Default

Defaults of the collateral happen when `refPerTok` decreases.

As detailed in 

## Implementation

### Main Contract

Solidity code for the collateral plugin can be found in [`MaplePoolCollateral.sol`][reserve-collateral-main-contract].

### Internal Dependencies

A number of auxilliary contracts are relied on in this implementation:

#### [IMaplePool.sol][reserve-collateral-maple-interface]

#### [AppreciatingFiatCollateral.sol][reserve-collateral-parent-contract]

Implements the revenue hiding and the refreshing logic.

## Relevant External Contracts

### Maven11 Permissionless Pool Contracts

USDC pool:

| Contract | Address | Commit Hash |
| -------- | ------- | ----------- |
| Pool     | [`0xd3cd37a7299B963bbc69592e5Ba933388f70dc88`](https://etherscan.io/address/0xd3cd37a7299B963bbc69592e5Ba933388f70dc88) | [`pool-v2       @ v1.0.0`](https://github.com/maple-labs/pool-v2/releases/tag/v1.0.0)       |

WETH pool:

| Contract | Address | Commit Hash |
| -------- | ------- | ----------- |
| Pool     | [`0xFfF9A1CAf78b2e5b0A49355a8637EA78b43fB6c3`](https://etherscan.io/address/0xFfF9A1CAf78b2e5b0A49355a8637EA78b43fB6c3) | [`pool-v2       @ v1.0.0`](https://github.com/maple-labs/pool-v2/releases/tag/v1.0.0)       |

### Oracle Contracts

| Contract | Address |
| -------- | ------- |
| PriceOracleUSDC         | [`0x5DC5E14be1280E747cD036c089C96744EBF064E7`](https://etherscan.io/address/0x5DC5E14be1280E747cD036c089C96744EBF064E7) |
| ChainLinkAggregatorUSDC | [`0x8fffffd4afb6115b954bd326cbe7b4ba576818f6`](https://etherscan.io/address/0x8fffffd4afb6115b954bd326cbe7b4ba576818f6) |
| ChainLinkAggregatorWETH | [`0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419`](https://etherscan.io/address/0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419) |

### ERC-20 Contracts

| Contract | Address |
| -------- | ------- |
| USDC  | [`0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48`](https://etherscan.io/address/0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48) |
| WETH9 | [`0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2`](https://etherscan.io/address/0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2) |
| MPL   | [`0x33349B282065b0284d756F0577FB39c158F935e6`](https://etherscan.io/address/0x33349B282065b0284d756F0577FB39c158F935e6) |
| xMPL  | [`0x4937a209d4cdbd3ecd48857277cfd4da4d82914c`](https://etherscan.io/address/0x4937a209d4cdbd3ecd48857277cfd4da4d82914c) |

## Tests

### Context

- `MAINNET_BLOCK = 16122421`

## Appendix: Exchange Rate Break-Down

Hidden inside the variable `totalAssets` are all the actions from the protocol.
The value can potentially decrease as well as increase during these operations:

- asset deposit
- asset withdrawal
- loan creation
- loan payment
- loan interests collection
- loan default / impairment

Here we'll break down the accounting formulas and track the exchange rate over time.
The goal is to verify that the RToken requirements are met, determine the conditions of default and assess the health of the pools.

### Risks

A single loan can take up to 97% of the pool's liquidity!
IE a single credit default will totally blow the ERC20 token.

And loan defaults **do** happen: 31M USDC and 3900 wETH were lost for each pool.
This is all due to a single company -Orthogonal Trading- not being solvable.
For the USDC pool, it represented 80% of the assets locked.

Still, at the time of writing, the pool delegates are now splitting the liquidity over several loans.

### Notations

To improve the readability of the formulas, the following notations will be used:

- $A$ for the total supply of assets in the pool
- $S$ for the total number of shares (LP tokens) on the pool assets
- $\Delta$ for the differences in these values between two blocks
- $\alpha$ for the exchange rate, IE `refPerToken`
- all the variables will be indexed by the block number $i$

### Main Formula

Then the exchange rate is written:

$$\begin{align}
\alpha_i = exchangeRate_i = \frac{totalAssets_i}{totalSupply_i} = \frac{A_i}{S_i}
\end{align}$$

With:

$$\begin{align}
totalAssets_i &= cash_i + assetsUnderManagement_i \\
              &= cash_i + \sum_j \Big({outstandingPrincipal_{i,j}} + {outstandingInterest_{i,j}}\Big) \\
              &= cash_i + \sum_j \Big({outstandingPrincipal_{i,j}} + {accountedInterest_i + issuanceRate \times (t_i - domainStart)}\Big) \\
\end{align}$$

Where $j$ iterates over the loans.

### Difference Between Withdraw and Deposit

The exchange rate is enforced on both the `deposit` and `withdraw` functions and equal to the ratio in the pool:

$$\alpha = \alpha_i = \frac{A_i}{S_i}$$

The rate differs for deposit and withdraw: the latter takes into account the temporary losses (called "unrealized losses" in the docs).

$$\begin{align}
exchangeRate = \frac{totalAssets-unrealizedLosses}{totalSupply}
\end{align}$$

It is implemented by the pool contract [`convertToExitAssets`][maple-code-pool-contract-converttoexitassets].

These losses lower the exchange rate and should be refunded by cover mechanisms over time.
In the end the two rates will be the same, the difference counters opportunities to withdraw / deposit at key times.

The collateral uses the version `convertToAssets`.

### Exchange Rate Fluctuations

#### Outside Of Scope

- stakers
- pool delegate
- fees

#### Fluctuations On Withdrawal / Redeeming

First, there's a rumor saying the shares aren't burnt upon withdrawal:
In Maple core-v2, it is false as can be seen [in the code][maple-code-pool-contract-withdraw].

So, for a withdrawal, the number of assets to remove from the pool are computed from the shares:

$$\begin{align}
\Delta A_i = \alpha_i * \Delta S_i \\
\Delta A_i < 0 \\
\Delta S_i < 0
\end{align}$$

To be precise, $\Delta A_i < 0$ means there's a transfer of assets and $\Delta S_i < 0$ means that the corresponding shares are burnt.

With this, we can prove that a withdrawal actually keeps the overall exchange rate constant:

$$\begin{align}
\alpha_{i+1} &= \frac{A_{i+1}}{S_{i+1}} \\
             &= \frac{A_i + \Delta A_i}{S_i + \Delta S_i} \\
             &= \frac{A_i + \Delta A_i}{S_i + \frac{\Delta A_i}{\alpha_i}} \\
             &= \alpha_i * \frac{A_i + \Delta A_i}{\alpha_i * S_i + \Delta A_i} \\
             &= \alpha_i
\end{align}$$

In short, the overall **`refPerTok` is unchanged**.

#### Fluctuations On Deposit

For a deposit, the shares are calculated from the number of assets entering the pool:

$$\begin{align}
\Delta S_i = \frac{\Delta A_i}{\alpha_i} \\
\Delta A_i > 0 \\
\Delta S_i > 0
\end{align}$$

Similarly to the withdrawal, **a deposit keeps the overall exchange rate constant**.
The equations are identical to the ones from the previous paragraph, only the signs of the deltas changed.

#### Fluctuations On Loan Creation

#### Fluctuations On Loan Payment

#### Fluctuations On Loan Interest Collection

#### Fluctuations On Loan Default / Impairment

[etherscan-usdc-oracle]: https://etherscan.io/address/0x5DC5E14be1280E747cD036c089C96744EBF064E7
[maple-app-usd-pool]: https://app.maple.finance/#/v2/lend/pool/0xd3cd37a7299b963bbc69592e5ba933388f70dc88
[maple-app-weth-pool]: https://app.maple.finance/#/v2/lend/pool/0xfff9a1caf78b2e5b0a49355a8637ea78b43fb6c3
[maple-code-pool-contract]: https://github.com/maple-labs/pool-v2/blob/main/contracts/Pool.sol
[maple-code-pool-contract-converttoassets]: https://github.com/maple-labs/pool-v2/blob/main/contracts/Pool.sol#L303
[maple-code-pool-contract-converttoexitassets]: https://github.com/maple-labs/pool-v2/blob/main/contracts/Pool.sol#L309
[maple-code-pool-contract-withdraw]: https://github.com/maple-labs/pool-v2/blob/main/contracts/Pool.sol#L126
[maple-docs-exchange-rate]:  https://maplefinance.gitbook.io/maple/technical-resources/pools/accounting/pool-exchange-rates
[maple-docs-overview]: https://maplefinance.gitbook.io/maple/technical-resources/protocol-overview
[maple-docs-pools]: https://maplefinance.gitbook.io/maple/technical-resources/pools/pools
[reserve-collateral-main-contract]: ./MaplePoolCollateral.sol
[reserve-collateral-maple-interface]: ./vendor/IMaplePool.sol
[reserve-collateral-parent-contract]: ./MaplePoolCollateral.sol
[reserve-collateral-usdc-deployment-script]: ../../../../scripts/deployment/phase2-assets/collaterals/deploy_maple_usdc_collateral.ts
[reserve-collateral-weth-deployment-script]: ../../../../scripts/deployment/phase2-assets/collaterals/deploy_maple_weth_collateral.ts
