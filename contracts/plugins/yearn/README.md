# Strategy Vaults collateral plugin

## Introduction

This is a collateral plugin written to enable the use of strategy vault tokens (i.e tokens that implement the `pricePerShare()` method like Yearn vault tokens and Ribbon Theta vault v2 tokens) as collateral on the Reserve protocol. The following resources will be helpful in understanding the reasoning behind this plugin's logic.

- [Yearn Finance docs](https://docs.yearn.finance/getting-started/intro#vaults)
- [Yearn Vaults](https://docs.yearn.finance/getting-started/products/yvaults/overview)
- [Ribbon Theta Vaults](https://docs.ribbon.finance/theta-vault/theta-vault)

## Summary

> Yearn Vaults are capital pools that automatically generate yield based on opportunities present in the market. Vaults benefit users by socializing gas costs, automating the yield generation and rebalancing process, and automatically shifting capital as opportunities arise.
>
> _— [Yearn Finance docs](https://docs.yearn.finance/getting-started/intro#vaults)_

>Theta Vaults run an automated European options selling strategy, which earns yield on a weekly basis through writing out of the money options and collecting the premiums.
>
> _- [Theta Vaults docs](https://docs.ribbon.finance/theta-vault/theta-vault#what-are-theta-vaults)_

Now these yields are generated using 'Strategies' set on the vaults which can in theory, incur a loss. These losses could be temporary, minor losses or very grievous depending on the cause of loss. Without this problem, using one of these tokens as collateral would have been pretty straightforward as the reference will just be the vault's underlying token. But there could be instances where a vault experiences a minor temporary loss and we actually want to tolerate the loss if it's within a certain range. Or a situation where we don't know the maximum possible loss that a vault can experience but we do know that it always recovers from that loss within a short while. For the Collateral plugin to be useful for a large number of vaults, there has to be a way to 'kinda circumvent' these problems.

Now the decision was to provide 2 different approaches based on the RToken's requirements.

1. The demurrage approach, where the exchange rate between the vault's token and its underlying token isn't taken into consideration for determining the plugin's default status but instead, a management fee is charged per time on the token. This is useful for the case where we expect the token to be generally appreciating over time but also expect some losses along the way which can't really be given a definite range.

2. The revenue hiding approach, where the rate reported to the protocol is slightly lower than what it should actually be to give room for fluctuations in the unreported region. This is useful for the case where we expect a maximum amount of loss per time that the vault can experience. The best part about this approach is that it's technically possible to deploy a plugin that doesn't tolerate any losses at all and just behaves as though we made the underlying token the direct reference.

These approaches are explained in more detail below.

### Use cases

There are basically 3 classifications of vault tokens (based on personal opinion really):

- **Fiat VaultToken:** Underlying token is a stable coin pegged to {UoA}. Think USDT, USDC, TUSD, YCRV, e.t.c.

- **Non Fiat VaultToken:** Underlying token is pegged to some other currency which isn't pegged to {UoA}. Think WBTC, WETH, EURS, e.t.c.

- **Generic VaultToken:** Underlying token can be anything. It could be an LP token or some other new token that doesn't have a chainlink feed yet. This variant of the plugin requires that you deploy a separate contract that implements the `IPriceProvider` interface which will be used to compute the price of the underlying token. Possibilities with this is that you could have an `IPriceProvider` that registers chainlink feeds for particular assets and uses that in the price computation. There could also be an `IPriceProvider` that calculates the price of a curve LP token. The possibilities really are endless.

There are implementations of these variants available for both approaches so it's really up to RToken governance to determine which approach best suits the RToken they want to create.

## Demurrage

The demurrage concept is discussed in more detail in `docs/collateral.md`. But basically it's one that charges a 'management fee' based on how long the token has been used as a collateral for that RToken. The fee charged is specified in basis points when deploying the plugin and is a value between 1 - 10000 inclusive. A value of `1` means that 0.01% of the {tok} will be taken as a fee per year and is computed per `PERIOD` which is a constant on the contract specified in seconds. A value of `10000` means that 100% will be charged as a fee.

`A = (1 - r)**t` \
where `r` is the demurrage fee charged per second (or hour or day, depending on what period is considered in charging fees)

The value of [A] is always decreasing such that after one year, \
`A == (A * (10000 - feeBasisPoints) / 10000)` \
For simplicity sake, we can just provide `(1 - r)`
as a variable since that's also constant (let's call it `ratePerPeriod`). \
A helper function has been created in `test/utils/demurrage.ts` to generate`ratePerPeriod`

Details on the constructor parameters are provided in the Setup section below.

The accounting units chosen for this approach are somewhat peculiar:

- `{tok}`: the token itself being used as collateral
- `{ref}`: a synthetic unit that reflects the amount charged as a fee on the token
- `{target}`: also synthetic and increases along with the `{ref}`, and is named something like, `DMyvBTC100`. More generally, `DM<token name><basis points>`.
- `{UoA}`: USD

### Setup

**Fiat Collateral**

File: `contracts/plugins/yearn/DMVaultTokenFiatCollateral.sol`

Constructor args
| Parameter | Description |
|-----------|---------------------------------------|
| `vault_` | The address of the vault contract, which is also the ERC20 token |
| `maxTradeVolume_` | The max trading volume of the collateral | <!--TODO -->
| `fallbackPrice_` | The price to use as a fallback for the {tok} incase of a broken price feed. Must be greater than zero. |
| `targetName_` | The target name for this collateral. Because it's a synthetic unit, the target name should look something like, `DMyvBTC100`. More generally, `DM<token name><basis points>`. |
| `delayUntilDefault_` | The amount of time the collateral should spend in the IFFY state on a soft default before being marked as DISABLED. |
| `ratePerPeriod_` | The `ratePerPeriod` as explained earlier in FIXED values (`uint192`) |
| `chainlinkFeed_` | The chainlink feed to get price data of the `{ref}` against the `{UoA}` |
| `oracleTimeout_` | The time after which to consider data from the chainlink feed as stale. |
| `defaultThreshold_` | The amount of deviation the `{ref}` will have to experience against `{UoA}` that will trigger a soft default. |

**Non-fiat Collateral**

File: `contracts/plugins/yearn/DMVaultTokenNonFiatCollateral.sol`

Constructor args
| Parameter | Description |
|-----------|---------------------------------------|
| `vault_` | The address of the vault contract, which is also the ERC20 token |
| `maxTradeVolume_` | The max trading volume of the collateral | <!--TODO -->
| `fallbackPrice_` | The price to use as a fallback for the {tok} incase of a broken price feed. Must be greater than zero. |
| `targetName_` | The target name for this collateral. Because it's a synthetic unit, the target name should look something like, `DMyvBTC100`. More generally, `DM<token name><basis points>`. |
| `delayUntilDefault_` | The amount of time the collateral should spend in the IFFY state on a soft default before being marked as DISABLED. |
| `ratePerPeriod_` | The `ratePerPeriod` as explained earlier in FIXED values (`uint192`) |
| `underlyingTargetToUoAFeed_` | The chainlink feed to get price data of the `{target}` against the `{UoA}` |
| `underlyingRefToTargetFeed_` | The chainlink feed to get price data of the `{ref}` against the `{target}` |
| `oracleTimeout_` | The time after which to consider data from the chainlink feed as stale. |
| `defaultThreshold_` | The amount of deviation the `{ref}` will have to experience against `{UoA}` that will trigger a soft default. |

**Generic Collateral**

File: `contracts/plugins/yearn/DMVaultTokenGenericCollateral.sol`

Constructor args
| Parameter | Description |
|-----------|--------------------------------------|
| `vault_` | The address of the vault contract, which is also the ERC20 token |
| `maxTradeVolume_` | The max trading volume of the collateral | <!--TODO -->
| `fallbackPrice_` | The price to use as a fallback for the {tok} incase of a broken price feed. Must be greater than zero. |
| `targetName_` | The target name for this collateral. Because it's a synthetic unit, the target name should look something like, `DMyvBTC100`. More generally, `DM<token name><basis points>`. |
| `delayUntilDefault_` | The amount of time the collateral should spend in the IFFY state on a soft default before being marked as DISABLED. |
| `ratePerPeriod_` | The `ratePerPeriod` as explained earlier in FIXED values (`uint192`) |
| `priceProvider_` | The address of the `IPriceProvider` to use for the collateral |
| `underlyingToken_` | The address of the vault's underlying token |

## Revenue Hiding

The revenue hiding concept is also discussed in more detail in `docs/collateral.md`. These collateral plugins don't report a set amount of appreciation in the token to allow for price fluctuations within that price band. The percentage to be hidden is specified in basis points when deploying the plugin and is a value between 0 - 10000 inclusive. A value of `1` means that 0.01% of the revenue will be hidden while a value of `10000` means that 100% will be hidden.
Details on the constructor parameters are provided in the Setup section below.

The accounting units chosen for this approach are:

- `{tok}`: the yToken itself being used as collateral
- `{ref}`: `yToken.token()`, the underlying token of the vault
- `{target}`: USD, EUR, BTC, e.t.c
- `{UoA}`: USD

One can actually deploy an RToken that doesn't hide any revenue by setting the basis points to 0. This creates an RToken that immediately defaults when the vault experiences a loss. This might not be a problem though, since the yearn vaults on [vaults.yearn.finance](https://vaults.yearn.finance) are said to be "uponly".

### Setup

**Fiat Collateral**

File: `contracts/plugins/yearn/RHVaultTokenFiatCollateral.sol`

Constructor args
| Parameter | Description |
|-----------|-------------------------------------|
| `vault_` | The address of the vault contract, which is also the ERC20 token |
| `maxTradeVolume_` | The max trading volume of the collateral | <!--TODO -->
| `fallbackPrice_` | The price to use as a fallback for the {tok} incase of a broken price feed. Must be greater than zero. |
| `targetName_` | The target name for this collateral |
| `delayUntilDefault_` | The amount of time the collateral should spend in the IFFY state on a soft default before being marked as DISABLED. |
| `basisPoints_` | Percentage of revenue to hide |
| `chainlinkFeed_` | The chainlink feed to get price data of the `{ref}` against the `{UoA}` |
| `oracleTimeout_` | The time after which to consider data from the chainlink feed as stale. |
| `defaultThreshold_` | The amount of deviation the `{ref}` will have to experience against `{UoA}` that will trigger a soft default. |

**Non-fiat Collateral**

File: `contracts/plugins/yearn/RHVaultTokenNonFiatCollateral.sol`

Constructor args
| Parameter | Description |
|-----------|----------------------------------------|
| `vault_` | The address of the vault contract, which is also the ERC20 token |
| `maxTradeVolume_` | The max trading volume of the collateral | <!--TODO -->
| `fallbackPrice_` | The price to use as a fallback for the {tok} incase of a broken price feed. Must be greater than zero. |
| `targetName_` | The target name for this collateral. |
| `delayUntilDefault_` | The amount of time the collateral should spend in the IFFY state on a soft default before being marked as DISABLED. |
| `basisPoints_` | Percentage of revenue to hide |
| `underlyingTargetToUoAFeed_` | The chainlink feed to get price data of the `{target}` against the `{UoA}` |
| `oracleTimeout_` | The time after which to consider data from the chainlink feed as stale. |
| `underlyingRefToTargetFeed_` | The chainlink feed to get price data of the `{ref}` against the `{target}` |
| `defaultThreshold_` | The amount of deviation the `{ref}` will have to experience against `{UoA}` that will trigger a soft default. |

**Generic Collateral**

File: `contracts/plugins/yearn/RHVaultTokenGenericCollateral.sol`

Constructor args
| Parameter | Description |
|-----------|---------------------------------------|
| `vault_` | The address of the vault contract, which is also the ERC20 token |
| `maxTradeVolume_` | The max trading volume of the collateral | <!--TODO -->
| `fallbackPrice_` | The price to use as a fallback for the {tok} incase of a broken price feed. Must be greater than zero. |
| `targetName_` | The target name for this collateral. |
| `delayUntilDefault_` | The amount of time the collateral should spend in the IFFY state on a soft default before being marked as DISABLED. |
| `basisPoints_` | Percentage of revenue to hide |
| `priceProvider_` | The address of the `IPriceProvider` to use for the collateral |
| `underlyingToken_` | The address of the vault's underlying token |
