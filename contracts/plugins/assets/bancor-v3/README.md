# Bancor v3 Pool Token Collaterals

## Introduction

[Bancor][bancor-docs-overview] is a decentralized network of on-chain automated market makers (AMMs).

It supports instant, low-cost trading, as well as Single-Sided Liquidity Provision and Liquidity Protection for any listed token.

Participants in the liquidity pools deposit assets (like ETH) and receive BN tokens (like bnETH) in return.

Bancor more than a hundred of liquidity pools, which cover new and old tokens, stables and derivatives alike.

## Pool Accounting

### Units

Examples of fiat tokens:

| `tok`    | `ref` | `tgt` | `UoA` |
| :------: | :---: | :---: | :---: |
|  bnUSDc  | USDC  |  USD  |  USD  |
|  bnDAI   | DAI   |  USD  |  USD  |

And non-fiat tokens:

| `tok`    | `ref` | `tgt` | `UoA` |
| :------: | :---: | :---: | :---: |
|  bnETH   | ETH   |  ETH  |  USD  |

There are many more tokens in the Bancor protocol, and these contracts can be used for any.

### Exchange Rate Calculation (refPerTok)

Bancor has a decent documentation, very practical.
However the "how-to" guides don't say much on the internal mechanics...

The pool contracts provide the [`poolTokenToUnderlying`][bancor-code-pool-contract-pooltokentounderlying] view, which computes:

$$\begin{align}
exchangeRate = \frac{totalAssets}{totalSupply}
\end{align}$$

Where the `exchangeRate` is actually `refPerTok`.

The `totalAssets` take the accrued interests and past losses into account.

The value of the LP tokens accrues every block with the interests collected from loans on the liquidity gathered.

### Price Calculation

Like any other collateral, the price is `{uoa/target} * {target/ref} * {ref/tok}`.

For the USDC pool:

- `{target/ref} = {USD/USDC}` is retrieved via the [USDC to USD Chainlink oracle][chainlink-feed-usdc-to-usd]
- `{uoa/target} = 1` does not need any processing

While the wETH pool has:

- `{target/ref} = {ETH/wETH} = 1` is set on contract creation
- `{uoa/target} = {USD/ETH}` uses the [ETH to USD Chainlink oracle][chainlink-feed-eth-to-usd]

### Conditions of Default

Defaults of the collateral happen when `refPerTok` decreases below the allowed dropped set for "revenue hiding".

And this happens iff `convertToAssets` from the ERC4626 decreases.

As detailed in [appendix section](#appendix-exchange-rate-break-down) this can only be triggered by loan default.
This section also explains why the collateral does not default on loan impairment.

### Fees

[conversionFee](https://github.com/bancorprotocol/docs/blob/master/guides/querying-a-pool-contract.md)

### Rewards

## Deployment

### Scripts

The deployment of the Maple Pool collaterals can be automated with a script.

An example is given for the [USDC pool][reserve-collateral-usdc-deployment-script].

### Parameters

```solidity
struct CollateralConfig {
    uint48 priceTimeout; // 604800 {s} (1 week)
    AggregatorV3Interface chainlinkFeed; // "0x8fffffd4afb6115b954bd326cbe7b4ba576818f6" {USDC/USD}
    uint192 oracleError; // 0.0025 {1}
    IERC20Metadata erc20; // "0xd3cd37a7299B963bbc69592e5Ba933388f70dc88"
    uint192 maxTradeVolume; // 1e6 {UoA}
    uint48 oracleTimeout; // 86400 {s} (24h)
    bytes32 targetName; // bytes32 representation of "USD"
    uint192 defaultThreshold; // 0.05 {1}
    uint48 delayUntilDefault; // 86400 {s} (24h)
}
uint192 revenueHiding; // 1e-6 allowed drop, as a ratio of the refPerTok 
```

For the wETH pool:

```solidity
struct CollateralConfig {
    uint48 priceTimeout; // 604800 {s} (1 week)
    AggregatorV3Interface chainlinkFeed; // "0x0000000000000000000000000000000000000001" {ETH/wETH} does not require an oracle
    uint192 oracleError; // 0.005 {1} which is actually the error for the {USD/ETH} oracle here
    IERC20Metadata erc20; // "0xFfF9A1CAf78b2e5b0A49355a8637EA78b43fB6c3"
    uint192 maxTradeVolume; // 1e6 {UoA}
    uint48 oracleTimeout; // 3600 {s} (1h)
    bytes32 targetName; // bytes32 representation of  "ETH"
    uint192 defaultThreshold; // 0.15 {1}
    uint48 delayUntilDefault; // 86400 {s} (24h)
}
AggregatorV3Interface uoaPerTargetChainlinkFeed; // "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419"
uint48 uoaPerTargetOracleTimeout; // 3600 {s} (1h)
uint192 revenueHiding; // 1e-6 allowed drop, as a ratio of the refPerTok
bool constantTargetPerRef; // true ({target/ref} does not call an external feed)
```

## Implementation

### Main Contracts

Solidity code for the fiat collateral plugin can be found in [`BnTokenFiatCollateral.sol`][reserve-collateral-fiat-contract].

The non-fiat pools -like ETH- rely on [`BnTokenNonFiatCollateral.sol`][reserve-collateral-non-fiat-contract].

The PoolCollection address changes from time to time. To identify the latest address

### Internal Dependencies

This implementation relies on a number of auxiliary contracts:

#### [IBnToken.sol][reserve-collateral-maple-interface]

Used to interact with both permissionless pools.

### [IPoolCollection][]

bla

#### [BnTokenMock.sol][reserve-collateral-maple-mock]

Allows to manipulate the exchange rate on the pools to test the behavior of the collateral.

#### [AppreciatingFiatCollateral.sol][reserve-collateral-parent-contract]

Implements the revenue hiding and the refreshing logic on top of all the common logic of assets.

## Relevant External Contracts

### Maven11 Permissionless Pool Contracts

| Contract  | Address | Commit Hash |
| --------- | ------- | ----------- |
| USDC Pool | [`0xd3cd37a7299B963bbc69592e5Ba933388f70dc88`](https://etherscan.io/address/0xd3cd37a7299B963bbc69592e5Ba933388f70dc88) | [`pool-v2       @ v1.0.0`](https://github.com/maple-labs/pool-v2/releases/tag/v1.0.0)       |
| wETH Pool | [`0xFfF9A1CAf78b2e5b0A49355a8637EA78b43fB6c3`](https://etherscan.io/address/0xFfF9A1CAf78b2e5b0A49355a8637EA78b43fB6c3) | [`pool-v2       @ v1.0.0`](https://github.com/maple-labs/pool-v2/releases/tag/v1.0.0)       |

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

## Tests

### Running The Tests

The tests require more memory than the defaults allow:

```bash
NODE_OPTIONS="--max-old-space-size=8192" yarn run hardhat test test/plugins/individual-collateral/bancor-v3/BnTokenFiatCollateral.test.ts
```

The Hardhat option `--max-memory 8192` didn't work for me.
I had to use `NODE_OPTIONS` to pass parameters from Yarn to Node.

### Context

- `FORK_BLOCK = 16964294` (the pools were created at `16162536` and `16162554`)

### List Of Unit Tests

Most of the tests come from [the collateral test suite][reserve-collateral-parent-test-script].

The Maple contracts are plugged into this testing suite by implementing the absract factories in [this script][reserve-collateral-test-script].

## Appendix: Exchange Rate Break-Down

Judging from historic data on the blockchain, the `{ref/tok}` can move up as-well as down:

USDC Pool                                  | WETH Pool
:-----------------------------------------:|:------------------------------------------:
![][reserve-collateral-plot-usdc-overview] | ![][reserve-collateral-plot-weth-overview]

[chainlink-feed-usdc-to-usd]: https://etherscan.io/address/0x8fffffd4afb6115b954bd326cbe7b4ba576818f6
[bancor-app-pools-list]: https://app.bancor.network/earn
[bancor-code-pool-contract]: https://github.com/maple-labs/pool-v2/blob/main/contracts/Pool.sol
[bancor-code-pool-contract-pooltokentounderlying]: https://github.com/bancorprotocol/contracts-v3/blob/dev/contracts/pools/PoolCollection.sol#L468
[bancor-docs-overview]: https://docs.bancor.network/about-bancor-network/bancor-v3
[bancor-docs-pools]: https://docs.bancor.network/about-bancor-network/faqs/liquidity-pools
[reserve-collateral-fiat-contract]: ./BnTokenFiatCollateral.sol
[reserve-collateral-non-fiat-contract]: ./BnTokenNonFiatCollateral.sol
[reserve-collateral-maple-interface]: ./vendor/IBnToken.sol
[reserve-collateral-maple-mock]: ../../mocks/BnTokenMock.sol
[reserve-collateral-parent-contract]: ../AppreciatingFiatCollateral.sol
[reserve-collateral-parent-test-script]: ../../../../test/plugins/individual-collateral/collateralTests.ts
[reserve-collateral-plot-usdc-overview]: ../../../../.github/assets/images/ref-per-tok_usdc-pool_overview.png
[reserve-collateral-plot-weth-overview]: ../../../../.github/assets/images/ref-per-tok_weth-pool_overview.png
[reserve-collateral-plot-usdc-zoom-unrealized-loss]: ../../../../.github/assets/images/ref-per-tok_usdc-pool_zoom-unrealized-loss.png
[reserve-collateral-plot-weth-zoom-unrealized-loss]: ../../../../.github/assets/images/ref-per-tok_weth-pool_zoom-unrealized-loss.png
[reserve-collateral-plot-usdc-zoom-normal-operation]: ../../../../.github/assets/images/ref-per-tok_usdc-pool_zoom-normal-operation.png
[reserve-collateral-plot-weth-zoom-normal-operation]: ../../../../.github/assets/images/ref-per-tok_weth-pool_zoom-normal-operation.png
[reserve-collateral-pull-request]: https://github.com/reserve-protocol/protocol/pull/757
[reserve-collateral-test-script]: ../../../../test/plugins/individual-collateral/bancor-v3/BnTokenFiatCollateral.test.ts
[reserve-collateral-usdc-deployment-script]: ../../../../scripts/deployment/phase2-assets/collaterals/deploy_maple_pool_usdc_collateral.ts
[reserve-collateral-weth-deployment-script]: ../../../../scripts/deployment/phase2-assets/collaterals/deploy_maple_pool_weth_collateral.ts
