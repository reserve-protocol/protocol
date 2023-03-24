# Maple Finance Permissionless Pools Collateral Plugin

## Introduction

[Maple Finance][maple-docs-overview] is a DeFi protocol providing capital to institutional borrowers through globally accessible fixed-income yield opportunities.

Participants in the liquidity pools deposit USDC or wETH and receive LP tokens in return.
The value of the LP tokens accrues every block with the interests collected from loans on the liquidity gathered.

In the end the tokens are redeemable for the underlying assets at the exchange rate of the time, which should have increased.
There is no fee on withdrawal.

## Deployment

Deploy the collateral plugin `MaplePoolCollateral.sol` with constructor arguments

```
uint192 fallbackPrice_, // 1 USDC
AggregatorV3Interface chainlinkFeed_, // USDC feed
IERC20Metadata erc20_, // wrapped staked Goldfinch position
uint192 maxTradeVolume_, // system default
uint48 oracleTimeout_, // system default
bytes32 targetName_, // USD
uint192 defaultThreshold_, // system default
uint256 delayUntilDefault_, // system default
IGoldfinchSeniorPool goldfinch_, // Goldfinch Senior Pool contract
uint192 allowedDropBasisPoints_ // e.g. 200 = 2%
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

The token / shares given to liquidity providers in return for their assets is not named.
Here I called it `LPT`, for "liquidity provider token".

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

## Implementation

### Main Contract

Solidity code for the collateral plugin can be found in [`MaplePoolCollateral.sol`][reserve-plugin-collateral-contract].

### Internal Dependencies

A number of auxilliary contracts are relied on in this implementation:

#### [UniV3OracleAsset.sol](../assets/UniV3OracleAsset.sol)

The price of GFI is not avaialble through a Chainlink feed. A Uniswap V3 pair for it exists, however, so we use the `UniV3OracleAsset.sol` contract to query the price of GFI in USD.

#### [GoldfinchStakingWrapper.sol](./GoldfinchStakingWrapper.sol)

GSP only earns GFI rewards when staked in a Synthetix-style staking contract. These positions are not inherently transferable, so we use the `GoldfinchStakingWrapper.sol` contract to wrap the staking positions in ERC20 tokens, which are in turn used as the `erc20` token in the collateral adapter.

#### [RevenueHiding.sol](../assets/RevenueHiding.sol)

Revenue hiding is used in the present implementation to permit a small drop in GSP share price due to any individual borrowers within the Senior Pool defaulting. This is to prevent the collateral adapter from being marked `DISABLED` when the Senior Pool is still for the most part healthy.

In the tests, I initially configure a 2% allowable drop in GSP share price before the collateral adapter is marked `DISABLED`. This is loosely set heuristically, but there is some data to support this. The senior pool comprises a diversified portfolio of 14 borrowers, none of which have defaulted on payments in the history of Goldfinch's operations for the past 1.5 years. A Dune dashboard with detailed metrics is found here https://dune.com/fanhong/goldfinch-finance-credit-monitor.

(credit to dna#9430 for the creating the abstract RevenueHiding contract)

#### refPerTok

The amount of USDC redeemable for each `gspToken` is queried with the pool `sharePrice()` method (e.g. 1.1 `USDC`/`gspToken`). A haircut of 0.5% is applied to this value to account for the withdrawal fee (arriving at the `strictPrice`), with the additional application of revenue hiding discussed above to arrive at `refPerTok`.

## Relevant External Contracts

### Maven11 USDC Pool Contracts

| Contract | Address | Commit Hash |
| -------- | ------- | ----------- |
| Pool                      | [`0xd3cd37a7299B963bbc69592e5Ba933388f70dc88`](https://etherscan.io/address/0xd3cd37a7299B963bbc69592e5Ba933388f70dc88) | [`pool-v2       @ v1.0.0`](https://github.com/maple-labs/pool-v2/releases/tag/v1.0.0)       |
| PoolManager (Proxy)       | [`0x00d950A41a0d277ed91bF9fD366a5523FEF0371e`](https://etherscan.io/address/0x00d950A41a0d277ed91bF9fD366a5523FEF0371e) | [`proxy-factory @ v1.0.0`](https://github.com/maple-labs/proxy-factory/releases/tag/v1.0.0) |
| LoanManager (Proxy)       | [`0x74CB3c1938A15e532CC1b465e3B641C2c7e40C2b`](https://etherscan.io/address/0x74CB3c1938A15e532CC1b465e3B641C2c7e40C2b) | [`proxy-factory @ v1.0.0`](https://github.com/maple-labs/proxy-factory/releases/tag/v1.0.0) |
| WithdrawalManager (Proxy) | [`0x7ED195a0AE212D265511b0978Af577F59876C9BB`](https://etherscan.io/address/0x7ED195a0AE212D265511b0978Af577F59876C9BB) | [`proxy-factory @ v1.0.0`](https://github.com/maple-labs/proxy-factory/releases/tag/v1.0.0) |
| PoolDelegateCover (Proxy) | [`0x9c74C5147653041239bb31C799c54767D9953f7D`](https://etherscan.io/address/0x9c74C5147653041239bb31C799c54767D9953f7D) | [`proxy-factory @ v1.0.0`](https://github.com/maple-labs/proxy-factory/releases/tag/v1.0.0) |

### Maven11 WETH Pool Contracts

| Contract | Address | Commit Hash |
| -------- | ------- | ----------- |
| Pool                      | [`0xFfF9A1CAf78b2e5b0A49355a8637EA78b43fB6c3`](https://etherscan.io/address/0xFfF9A1CAf78b2e5b0A49355a8637EA78b43fB6c3) | [`pool-v2       @ v1.0.0`](https://github.com/maple-labs/pool-v2/releases/tag/v1.0.0)       |
| PoolManager (Proxy)       | [`0x833A5c9Fc016a87419D21B10B64e24082Bd1e49d`](https://etherscan.io/address/0x833A5c9Fc016a87419D21B10B64e24082Bd1e49d) | [`proxy-factory @ v1.0.0`](https://github.com/maple-labs/proxy-factory/releases/tag/v1.0.0) |
| LoanManager (Proxy)       | [`0x373BDCf21F6a939713d5DE94096ffdb24A406391`](https://etherscan.io/address/0x373BDCf21F6a939713d5DE94096ffdb24A406391) | [`proxy-factory @ v1.0.0`](https://github.com/maple-labs/proxy-factory/releases/tag/v1.0.0) |
| WithdrawalManager (Proxy) | [`0x1Bb73D6384ae73DA2101a4556a42eaB82803Ef3d`](https://etherscan.io/address/0x1Bb73D6384ae73DA2101a4556a42eaB82803Ef3d) | [`proxy-factory @ v1.0.0`](https://github.com/maple-labs/proxy-factory/releases/tag/v1.0.0) |
| PoolDelegateCover (Proxy) | [`0xdfDDE84b117f038785A2B1805B10D5C4d616dA08`](https://etherscan.io/address/0xdfDDE84b117f038785A2B1805B10D5C4d616dA08) | [`proxy-factory @ v1.0.0`](https://github.com/maple-labs/proxy-factory/releases/tag/v1.0.0) |

### Oracle Contracts

| Contract | Address |
| -------- | ------- |
| PriceOracleUSDC         | [`0x5DC5E14be1280E747cD036c089C96744EBF064E7`](https://etherscan.io/address/0x5DC5E14be1280E747cD036c089C96744EBF064E7) |
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

- The unit tests in `GoldfinchCollateral.test.ts` are predicated on `MAINNET_BLOCK = 16122421` as the interface of their staking rewards contract has been recently upgraded.

## Appendix: Exchange Rate Break-Down

Hidden inside the variable `totalAssets` are all the actions from the protocol.
The value can potentially decrease as well as increase during these operations:

- asset deposit
- asset withdrawal
- loan payment
- loan default / impairment
- loan interests collection

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

Where both $\Delta A_i$ and $\Delta S_i$ are negative.

#### Fluctuations On Deposit

For a deposit, the shares are calculated from the number of assets entering the pool:

$$\begin{align}
\Delta S_i = \frac{\Delta A_i}{\alpha_i} \\
\Delta A_i > 0 \\
\Delta S_i > 0
\end{align}$$

Similarly to the withdrawal, a deposit keeps the overall exchange rate constant.
The equations are identical to the ones from the previous paragraph, only the signs of the deltas changed.

[etherscan-usdc-oracle]: https://etherscan.io/address/0x5DC5E14be1280E747cD036c089C96744EBF064E7
[maple-code-pool-contract]: https://github.com/maple-labs/pool-v2/blob/main/contracts/Pool.sol
[maple-code-pool-contract-converttoassets]: https://github.com/maple-labs/pool-v2/blob/main/contracts/Pool.sol#L303
[maple-code-pool-contract-converttoexitassets]: https://github.com/maple-labs/pool-v2/blob/main/contracts/Pool.sol#L309
[maple-code-pool-contract-withdraw]: https://github.com/maple-labs/pool-v2/blob/main/contracts/Pool.sol#L126
[maple-docs-exchange-rate]:  https://maplefinance.gitbook.io/maple/technical-resources/pools/accounting/pool-exchange-rates
[maple-docs-overview]: https://maplefinance.gitbook.io/maple/technical-resources/protocol-overview
[maple-docs-pools]: https://maplefinance.gitbook.io/maple/technical-resources/pools/pools
[reserve-plugin-collateral-contract]: ./MaplePoolCollateral.sol
