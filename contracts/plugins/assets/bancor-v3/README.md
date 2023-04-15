# Bancor v3 Pool Token Collaterals

## Introduction

[Bancor][bancor-docs-overview] is a decentralized network of on-chain automated market makers (AMMs).

It supports instant, low-cost trading, as well as Single-Sided Liquidity Provision and Liquidity Protection for any listed token.

Participants in the liquidity pools deposit assets (like ETH) and receive BN tokens (like bnETH) in return.

Bancor has more than a hundred liquidity pools, which cover new and old tokens alike.

## Pool Accounting

### Units

Examples of fiat tokens:

| `tok`    | `ref` | `tgt` | `UoA` |
| :------: | :---: | :---: | :---: |
|  bnUSDc  | USDC  |  USD  |  USD  |
|  bnDAI   | DAI   |  USD  |  USD  |

Non-fiat tokens:

| `tok`    | `ref` | `tgt` | `UoA` |
| :------: | :---: | :---: | :---: |
|  bnLINK  | LINK  |  ETH  |  USD  |
|  bnBNT   | BNT   |  ETH  |  USD  |

And self-referential tokens:

| `tok`     | `ref`  | `tgt` | `UoA` |
| :-------: | :----: | :---: | :---: |
|  bnETH    | ETH    |  ETH  |  USD  |

There are many more tokens in the Bancor protocol, and these collateral contracts can be used for any.

### Exchange Rate Calculation (refPerTok)

#### Base Formula

The pool collection contract provides the [`poolTokenToUnderlying`][bancor-code-pooltokentounderlying] view, which computes:

$$\begin{align}
baseTokenAmount = \frac{poolTokenAmount * stakedBalance}{poolTokenSupply}
\end{align}$$

So asking to convert `1e18` pool tokens results in `baseTokenAmount` formated as a rate in fixed point.

#### Evolution

The `stakedBalance` take the accrued trading fees and flashloan interests into account.
Both actions are neutral in terms of overall liquidity, so the rate only increases with the fees.

Deposit and withdraw don't affect the rate.

So the `refPerTok` is expected to increase over time.

This is confirmed by the historical data, as can be seen on [the plots](#appendix-exchange-rate-break-down).

#### Transitive States & Fees

A pool can be in surplus or default depending on the liquidity amount compared to the omnipool BNT amount.
This ratio is different from the `refPerTok`.

Both surplus and default are expected and part of the normal operation of the pool.
The pool default is a shortage of liquidity, it is different from collateral default.

In case of default, the [protocol adds a fee on withdrawal][bancor-docs-withdrawal-fees].
This is temporary and independent of the `refPerTok`.
It is meant to incentivize providers to keep their liquidity so that the pool recovers faster.

Those fees are **not** taken into account for the calculation of `refPerTok`: the collateral holds on the pool tokens as long as it is healthy.

Also it would create spikes in the `refPerTok` and could make the collateral default while the `refPerTok` did not decrease.
This seems like a more precise calculation, but it's actually a very bad idea.

#### Conditions of Default

Defaults of the collateral happen when `refPerTok` decreases below the allowed dropped set for "revenue hiding".

As explained above the rate won't decrease on normal operation: it would require extraordinary events, which haven't happened yet.

### Price Calculation

Like any other collateral, the price is `{uoa/target} * {target/ref} * {ref/tok}`.

Among the many Bancor pools, there are fiat, self-referential and non-fiat tokens.
Which means either `{uoa/target} = 1` or `{target/ref} = 1` or both require an oracle.

For example, in the USDC pool:

- `{ref/tok}` is computed as explained in the previous section
- `{target/ref} = {USD/USDC}` is retrieved via the [USDC to USD Chainlink oracle][chainlink-feed-usdc-to-usd]
- `{uoa/target} = 1` does not need any processing

### Rewards

Bancor hands out BNT rewards to incentivize new liquidity providers.

Only a few pools are eligible: the collateral first checks whether a reward program exists before claiming rewards. 

## Deployment

### Scripts

The deployment of the Bancor pool collaterals can be automated with a script.

An example is given for the [USDC pool][reserve-collateral-deployment-script].

### Parameters

For example, the USDC pool collateral can be deployed with:

```solidity
struct CollateralConfig {
    uint48 priceTimeout; // 604800 {s} (1 week)
    AggregatorV3Interface chainlinkFeed; // "0x8fffffd4afb6115b954bd326cbe7b4ba576818f6" {USDC/USD}
    uint192 oracleError; // 0.0025 {1}
    IERC20Metadata erc20; // "0xAd7bEc56506D181F994ec380b1BA34fb3FbfBaD3" USDC pool
    uint192 maxTradeVolume; // 1e6 {UoA}
    uint48 oracleTimeout; // 86400 {s} (24h)
    bytes32 targetName; // bytes32 representation of "USD"
    uint192 defaultThreshold; // 0.05 {1}
    uint48 delayUntilDefault; // 86400 {s} (24h)
}
IPoolCollection public poolCollection; // "0xB67d563287D12B1F41579cB687b04988Ad564C6C"
IStandardRewards public standardRewards; // "0xb0B958398ABB0b5DB4ce4d7598Fb868f5A00f372"
uint192 revenueHiding; // 1e-6 allowed drop, as a ratio of the refPerTok 
```

The `PoolCollection` and `StandardRewards` contract addresses can be found:

- in [the docs][bancor-docs-addresses]
- or by querying [the bancor network contract][bancor-network-contract]

Supposedly, there may-be several contract instances and the second path allows to find the one matching a given pool.
However, at the time of writing (2023-04-15), there is only one `PoolCollection` and one `StandardRewards`.

## Implementation

### Main Contracts

Solidity code for the fiat collateral plugin can be found in [`BnTokenFiatCollateral.sol`][reserve-collateral-fiat-contract].

The [non-fiat][reserve-collateral-non-fiat-contract] & [self-referential][reserve-collateral-self-referential-contract] collaterals are built on top.

### Internal Dependencies

This implementation relies on a number of auxiliary contracts:

#### [IPoolToken.sol][reserve-collateral-pool-token-interface]

Used to interact with Bancor pools.

#### [IPoolCollection][reserve-collateral-pool-collection-interface]

This contract processes the exchange rate from the pool token to the underlying.

#### [IStandardRewards][reserve-collateral-standard-rewards-interface]

Allows to interact with programs and claims rewards.

#### [ContractRegistry][reserve-collateral-contract-registry]

The PoolCollection address may change from time to time:
this registry indexes Bancor contracts and allows to update the addresses.

#### [BnTokenMock.sol][reserve-collateral-pool-token-mock]

Can manipulate the exchange rate on the pools to test the behavior of the collateral.

#### [AppreciatingFiatCollateral.sol][reserve-collateral-parent-contract]

Implements the revenue hiding and the refreshing logic on top of all the common logic of assets.

## Relevant External Contracts

### Bancor Protocol

| Contract          | Address |
| ----------------- | ------- |
| Bancor Network    | [`0xeEF417e1D5CC832e619ae18D2F140De2999dD4fB`](https://etherscan.io/address/0xeEF417e1D5CC832e619ae18D2F140De2999dD4fB) |
| Pool Collection   | [`0xB67d563287D12B1F41579cB687b04988Ad564C6C`](https://etherscan.io/address/0xB67d563287D12B1F41579cB687b04988Ad564C6C) |
| Standard Rewards  | [`0xb0B958398ABB0b5DB4ce4d7598Fb868f5A00f372`](https://etherscan.io/address/0xb0B958398ABB0b5DB4ce4d7598Fb868f5A00f372) |

All the listed contracts are proxies, except the pool collection.
It may change and needs to be checked / updated regularly.

### ERC-20 Contracts

| Contract | Address |
| -------- | ------- |
| BNT      | [`0x1F573D6Fb3F13d689FF844B4cE37794d79a7FF1C`](https://etherscan.io/address/0x1F573D6Fb3F13d689FF844B4cE37794d79a7FF1C) |
| ETH      | `0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE` (made up, to index the ETH pools) |

### Pool Contracts

| Contract  | Address |
| --------- | ------- |
| BNT Pool  | [`0xAB05Cf7C6c3a288cd36326e4f7b8600e7268E344`](https://etherscan.io/address/0xAB05Cf7C6c3a288cd36326e4f7b8600e7268E344) |

The BNT pool holds the network tokens (from rewards) in exchange for bnBNT.
This is accomplished by staking the rewards (disabled by default).

### Oracle Contracts

| Contract | Address |
| -------- | ------- |
| ChainLinkAggregatorBNT  | [`0x1e6cf0d433de4fe882a437abc654f58e1e78548c`](https://etherscan.io/address/0x1e6cf0d433de4fe882a437abc654f58e1e78548c) |
| ChainLinkAggregatorLINK | [`0x2c1d072e956affc0d435cb7ac38ef18d24d9127c`](https://etherscan.io/address/0x2c1d072e956affc0d435cb7ac38ef18d24d9127c) |

## Tests

### Running The Tests

The tests require more memory than the defaults allow:

```bash
NODE_OPTIONS="--max-old-space-size=8192" yarn run hardhat test test/plugins/individual-collateral/bancor-v3/BnTokenFiatCollateral.test.ts
```

The Hardhat option `--max-memory 8192` didn't work for me.
I had to use `NODE_OPTIONS` to pass parameters from Yarn to Node.

### Context

- `FORK_BLOCK = 16964294`

### List Of Unit Tests

Most of the tests come from [the collateral test suite][reserve-collateral-parent-test-script].

The Bancor contracts are plugged into this testing suite by implementing the absract factories in [this script][reserve-collateral-test-script].

The test suite has an [extra script][reserve-collateral-plot-script] to plot `refPerTok` over historical data.

## Appendix: Exchange Rate Break-Down

Judging from historic data on the blockchain, the `{ref/tok}` has only moved up so far:

USDC Pool                                  | ETH Pool
:-----------------------------------------:|:------------------------------------------:
![][reserve-collateral-plot-overview-usdc] | ![][reserve-collateral-plot-overview-eth]

[chainlink-feed-usdc-to-usd]: https://etherscan.io/address/0x8fffffd4afb6115b954bd326cbe7b4ba576818f6
[bancor-app-pools-list]: https://app.bancor.network/earn
[bancor-network-contract]: https://etherscan.io/address/0xeEF417e1D5CC832e619ae18D2F140De2999dD4fB#readProxyContract
[bancor-code-pool-contract]: https://github.com/Bancor-labs/pool-v2/blob/main/contracts/Pool.sol
[bancor-code-pooltokentounderlying]: https://github.com/bancorprotocol/contracts-v3/blob/dev/contracts/pools/PoolCollection.sol#L468
[bancor-docs-addresses]: https://docs.bancor.network/developer-guides/contracts
[bancor-docs-overview]: https://docs.bancor.network/about-bancor-network/bancor-v3
[bancor-docs-withdrawal-fees]: https://github.com/bancorprotocol/docs/blob/master/developer-quick-start/removing-liquidity.md?plain=1#L73
[bancor-docs-pools]: https://docs.bancor.network/about-bancor-network/faqs/liquidity-pools
[reserve-collateral-contract-registry]: ./vendor/ContractRegistry.sol
[reserve-collateral-fiat-contract]: ./BnTokenFiatCollateral.sol
[reserve-collateral-non-fiat-contract]: ./BnTokenNonFiatCollateral.sol
[reserve-collateral-self-referential-contract]: ./BnTokenSelfReferentialCollateral.sol
[reserve-collateral-pool-collection-interface]: ./vendor/IPoolCollection.sol
[reserve-collateral-pool-token-interface]: ./vendor/IPoolToken.sol
[reserve-collateral-pool-token-mock]: ../../mocks/BnTokenMock.sol
[reserve-collateral-standard-rewards-interface]: ./vendor/IStandardRewards.sol
[reserve-collateral-parent-contract]: ../AppreciatingFiatCollateral.sol
[reserve-collateral-parent-test-script]: ../../../../test/plugins/individual-collateral/collateralTests.ts
[reserve-collateral-plot-overview-eth]: ../../../../.github/assets/images/bancor-v3/ref-per-tok_eth-pool_overview.png
[reserve-collateral-plot-overview-usdc]: ../../../../.github/assets/images/bancor-v3/ref-per-tok_usdc-pool_overview.png
[reserve-collateral-plot-script]: ../../../../test/plugins/individual-collateral/bancor-v3/plot.test.ts
[reserve-collateral-pull-request]: https://github.com/reserve-protocol/protocol/pull/757
[reserve-collateral-test-script]: ../../../../test/plugins/individual-collateral/bancor-v3/BnTokenFiatCollateral.test.ts
[reserve-collateral-deployment-script]: ../../../../scripts/deployment/phase2-assets/collaterals/deploy_bancorv3_bntoken_collateral.ts
