# Stargate Pool Plugin

## Introduction

[Stargate][stargate-docs-overview] A Composable Omnichain Native Asset Bridge

Stargate is the first bridge to solve the bridging trilemma. Existing bridges are forced to make trade-offs on the following core bridge features:
- **Instant Guaranteed Finality**: Users & Applications can trust that when they successfully commit a transaction on the source chain, it will arrive on the destination chain.
- **Native Assets**: Users & Applications swap in native assets as opposed to wrapped assets that require additional swaps to acquire the desired asset and corresponding fees.
- **Unified Liquidity**: Shared access of a single liquidity pool across multiple chains creates deeper liquidity for users & applications that trust in the bridge's reliability.

## Liquidity Pools
Users can add liquidity to ERC20 token-chain pools (i.e. USDC-Optimism) and receive either farm-based or transfer-based rewards
In exchange for adding liquidity to a pool, users receive LP tokens. These LP tokens (e.g. S*USDC) represent a **proportional share of the pooled assets**, allowing a user to reclaim their funds at any time.
Every time a liquidity pool is used for a transfer, a 2-10 basis point fee is collected on the transfer.
All Stargate  Pool contracts can be found in the link below 
[Pool IDs][stargate_pool_ids]

### 1. How will this plugin define the different units?

Stargate USDC Pool Contracts:

| `tok`         | `ref` | `tgt` | `UoA` |
| :-----------: | :---: | :---: | :---: |
|  S*USDC  | USDC  |  USD  |  USD  |

Stargate USDT Pool Contracts:

| `tok`         | `ref` | `tgt` | `UoA` |
| :-----------: | :---: | :---: | :---: |
|  S*USDT  | USDT  |  USD  |  USD  |

Stargate WETH Pool Contracts:

| `tok`         | `ref` | `tgt` | `UoA` |
| :-----------: | :---: | :---: | :---: |
|  S*SGETH  | wETH  |  ETH  |  USD  |

The token names are taken from the `symbol` method in the pool contracts.

### 2. Does the target collateral require a wrapper?
All LP tokens of stargate bridge are ERC20 so it does not need a wrapper 
there are no rewards for LP tokens unless you stake them in the specified contract and in that case it's not possible to stake them as a collateral plugin in Reserve so we can't get STG rewards in this case and we should ignore that

so we does not need a wrapper for this collateral



### Price Calculation
- `{ref/tok}`: reference per token is calculated based on following formula 
        ref/tok = totalLiquidity/ totalsupply 
- `{target/ref}`: we can get this rate from chainlink oracle (eg. USDC/USD for S*USDC token)
- `{UoA/target}`: this rate is always 1 in our collateral because both of them has the same unit of USD

Like any other collateral, the price is `{target/ref} * {ref/tok}`.

To keep the same logic / contract for both pools, the contract still uses the `chainlinkFeed` property and instantiates a mock oracle.
This mock oracle always returns 1 (10e8 with the decimals) as price.

#### None Decreasing `{ref/tok}`
based on the code of stargate pool total liquidity = total fees earned + totalDeposit - totalWithdrawals 
and we know that on deposit & withdrawals our ref per tok does not change because a users liquitiy wihtdrawal is calculated based on below formula 

withdrawalTokens = userLPamount * totalLiquidity/totalSupply 
it's obvious that totalLiquidity/totalSupply will be the same after withdrawals & Deposit 
and on swaps just the value of totalLiquidity will increase so we know that 

### 4. **For each of these prices, what are the critical trust assumptions?  Can any of these be manipulated within the course of a transaction?**
- chainlink feeds require trusting the chainlink protocol and the individual oracles for that price feed
- both  totalLiquidity & totalSupply are read from Stargate Pool contract so if an attacker exploit a vulnerability in this smart contract this rate is not trustable anymore 
    **in this case we will rely on the `stopSwap()` flag in the smart contract and the collateral will be set to DISABLE when this flag is true**

### 5. **Are there any protocol-specific metrics that should be monitored to signal a default in the underlying collateral?**
there  is a flag in the stargate smart contract that can be read with `stopSwap()` function this flag will be set true in extreme cases and the collateral will be set DISABLE when this flag is true

### Conditions of Default

Defaults of the collateral happen when `refPerTok` decreases below the allowed dropped set for "revenue hiding".
and this rare case will happen in when 

## Deployment
like other collaterals there is a deploy script  in `scripts\deployment\collaterals\deploy_stargate_usdc_collateral.ts`

### Parameters

paramaters are defined in `test\plugins\individual-collateral\stargate\constants.ts` separately

and this is paramater for the USDC pool:

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

## Tests

### Running The Tests

```bash
    yarn run hardhat test test/plugins/individual-collateral/stargate/StargatePoolCollateral.test.ts
```
or simply just

```bash
    yarn test:stargatePlugin
```

and for this you should `FORK=1` in .env file in your PC

[stargate-docs-overview]:"https://stargateprotocol.gitbook.io/stargate/"
[stargate_pool_ids]:"https://stargateprotocol.gitbook.io/stargate/developers/pool-ids"