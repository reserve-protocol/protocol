# Demurrage Collateral Plugins

**Demurrage** is a general term for a per-unit-time fee on assets-under-management (aka management fees)

## Background

Many assets on-chain do not have yield. While the Reserve Protocol is compatible with non-yielding assets, this introduces downsides: an RToken naively composed entirely of non-yielding collateral assets lacks RSR overcollateralization and governance.

In this case a revenue stream can be created by composing an inflationary reference + target units that refer to a falling quantity of the token unit. This results in a monotonically increasing `refPerTok()` that can be consumed by the protocol to measure appreciation.

There are side-effects to the `targetName`, however the rest of the collateral plugin remains much the same.

In principle demurrage can be added to any type of collateral, even already yield-bearing collateral.

**Units**

```solidity
/**
 * - tok = Tokenized X
 * - ref = Decayed X (since 2024-01-01 00:00:00 GMT+0000)
 * - target = Decayed X (since 2024-01-01 00:00:00 GMT+0000)
 * - UoA = USD
 */
```

### Reference Unit (inflationary)

The reference unit becomes naturally inflationary, resulting in a `refPerTok` of:

```
refPerTok(): 1 / (1 - demurrage_rate_per_second) ^ t
    where t is seconds since 01/01/2024 00:00:00 GMT+0000
```

The timestamp of 01/01/2024 00:00:00 GMT+0000 is chosen arbitrarily. It's not important what this value is, but there are benefits to using a common anchor (and 1970 is wastefully far).

In unix time this is `1704067200`

### Target Unit (inflationary)

The reference unit maintains a 1:1 rate against the target unit

```
targetPerRef(): 1
```

As a naming convention, we suggest:
`DMR{annual_demurrage_in_basis_points}{token_symbol}` or `DMR100USD`, for example

1. The `DMR` prefix is short for demurrage
2. The `annual_demurrage_in_basis_points` is a number such as 100 for 1% annually
3. The `token_symbol` is the symbol of the unit absent any demurrage

Collateral can only be automatically substituted in the basket with collateral that share the _exact_ same target unit. This unfortunately means a standard WETH collateral cannot be backup for a demurrage ETH collateral. Both the unit type and rate must be identical in order for two collateral to be in the same target unit class.

This also means there can be multiple demurrage collateral for a single token. We refer to these as tiers.

### Setting the basket weights

Prime basket weights are in units of January 1st 2024 collateral, not today's collateral. It doesn't matter if the collateral wasn't around in Jan 2024 -- when setting the basket weights the setter must take into account how much demurrage has occurred since January 1st 2024.

This is identical to the calculation for the `refPerTok()` function in the [DemurrageCollateral.sol](../contracts/plugins/assets/DemurrageCollateral.sol) contract, but calculating for an arbitrary timestamp.

```
weight = 1 / (1 - fee) ^ seconds;
```

`fee()` available on DemurrageCollateral contract

### Implementation

[DemurrageCollateral.sol](../contracts/plugins/assets/DemurrageCollateral.sol) implements a generalized demurrage collateral plugin that should support almost all use-cases

Sample usage:

- [deploy_cbbtc_100.ts](../scripts/deployment/phase2-assets/collaterals/deploy_cbbtc_100.ts)
- [deploy_eurc_100.ts](../scripts/deployment/phase2-assets/collaterals/deploy_eurc_100.ts)
- [deploy_paxg_100.ts](../scripts/deployment/phase2-assets/collaterals/deploy_paxg_100.ts)
- [deploy_arb_100.ts](../scripts/deployment/phase2-assets/collaterals/deploy_arb_100.ts)

TODO link to demurrage collateral factory address after deployment
