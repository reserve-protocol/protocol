# Goldfinch Senior Pool Collateral Plugin

## Introduction

[Goldfinch](https://app.goldfinch.finance/pools/senior) is a DeFi protocol providing a marketplace for unsecured lending to trusted institutional borrowers.

Goldfinch offers loans to a large number of borrowers. Goldfinch users can choose to lend to a specific borrower, or to a pool of borrowers. The latter is called the Senior Pool. If a borrower is late on their loan payments, any payments made go to the Senior Pool first. The Senior Pool is thus a diversified pool of loans, and is therefore less risky than lending to a single borrower.

Participants in the Senior Pool deposit USDC and receive FIDU tokens (also referred to as GSP) in return, which are redeemable for their initial collateral, with added interest from repayments minus a 0.5% withdrawal fee.

This collateral plugin allows for FIDU collateral to be used within the Reserve Protocol ecosystem (e.g. as part of baskets).

## Relevant External Contracts

The most pertinent external contracts for the Goldfinch Senior Pool collateral plugin are:

- Goldfinch Senior Pool: https://etherscan.io/address/0x8481a6ebaf5c7dabc3f7e09e44a89531fd31f822
- FIDU (receipt token): https://etherscan.io/token/0x6a445e9f40e0b97c92d0b8a3366cef1d67f700bf
- Staking (to earn GFI token rewards): https://etherscan.io/address/0xfd6ff39da508d281c2d255e9bbbfab34b6be60c3

## Implementation

Solidity code for the collateral plugin can be found [here](./GoldfinchSeniorPoolCollateral.sol), titled `GoldfinchSeniorPoolCollateral.sol`.

| `tok` | `ref` | `tgt` | `UoA` |
| :---: | :---: | :---: | :---: |
|  GSP  | USDC  |  USD  |  USD  |

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

### Deployment

Deploy the collateral plugin `GoldfinchSeniorPoolCollateral.sol` with constructor arguments

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

### Notes

- The unit tests in `GoldfinchCollateral.test.ts` are predicated on `MAINNET_BLOCK = 16122421` as the interface of their staking rewards contract has been recently upgraded.
