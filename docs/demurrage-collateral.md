# Demurrage Collateral Plugins

**Demurrage** is a general term for a per-unit-time fee on assets-under-management (aka management fees)

## Background

Many assets on-chain do not have yield. While the Reserve Protocol is compatible with non-yielding assets, this introduces downsides: an RToken naively composed entirely of non-yielding collateral assets lacks RSR overcollateralization and governance.

In this case a revenue stream can be created by composing a synthetic reference unit that refers to a falling quantity of the collateral token. This causes the reference unit to become inflationary with respect to the collateral unit, resulting in a monotonically increasing `refPerTok()` by definition.

There are side-effects to the `targetName`, however the rest of the collateral plugin remains the same.

### Reference Unit (inflationary)

The reference unit becomes naturally inflationary, resulting in a `refPerTok` of:

```
refPerTok(): 1 / (1 - demurrage_rate_per_second) ^ t
    where t is seconds since 01/01/2024 00:00:00 GMT+0000
```

The timestamp of 01/01/2024 00:00:00 GMT+0000 is chosen arbitrarily. It's not important what this value is, but there are benefits to using a common anchor (and 1970 is too far).

In unix time this is `1640995200`

### Target Unit

```
targetPerRef(): 1
```

`DMR{annual_demurrage_in_basis_points}{token_symbol}` or `DMR100USD`, for example

1. The `DMR` prefix is short for demurrage
2. The `annual_demurrage_in_basis_points` is a number such as 100 for 1% annually
3. The `token_symbol` is the symbol of what would have otherwise been the target unit had the collateral been purely SelfReferential

Collateral can only be automatically substituted in the basket with collateral that share the _exact_ same target unit. This unfortunately means a standard WETH collateral cannot be backup for a demurrage ETH collateral. Both the unit type and rate must be identical in order for two collateral to be in the same target unit class.

### Setting the basket weights

Prime basket weights are in units of January 1st 2024 collateral, not today's collateral. It doesn't matter if the collateral wasn't around in Jan 2024 -- when setting the basket weights the setter must take into account how much demurrage has occurred since January 1st 2024.

For example, say an asset has had 2% total demurrage since January 1st 2024 and you want to (on today's date) create a basket of that is worth $1: the correct basket weight to provide to `setPrimeBasket()` would be `1 / (1 - 0.02) = ~1.0204`.

To calculate total demurrage since 2024-01-01 00:00:00 UTC, use:

```
fee() ^ (seconds_since_2024_01_01)
```

(where `fee()` is the per-second demurrage rate found on the `DemurrageCollateral` contract below)

### Implementation

[DemurrageCollateral.sol](../contracts/plugins/assets/DemurrageCollateral.sol) implements a generalized demurrage collateral plugin that should support almost all use-cases
