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
    where t is seconds since 01/01/2020 00:00:00 UTC
```

The timestamp of 01/01/2020 00:00:00 GMT+0000 is chosen arbitrarily. It's not important what this value is, but there are benefits to using a common anchor (and 1970 is too far).

In unix time this is `1640995200`

### Target Unit

```
targetPerRef(): 1
```

The target unit must be named in a way that distinguishes it from the non-demurrage version of itself. We suggest the following naming scheme:

`DMR{annual_demurrage_in_basis_points}{token_symbol}` or `DMR100USD`, for example

The `DMR` prefix is short for demurrage; the `annual_demurrage_in_basis_points` is a number such as 100 for 1% annually; the `token_symbol` is the symbol of what would have otherwise been the target unit had the collateral been purely SelfReferential.

Collateral can only be automatically substituted in the basket with collateral that share the same target unit. This unfortuna
tely means that a standard WETH collateral would not be in the same class as our demurrage ETH collateral, unless the WETH collateral were also demurrage-based, and at the same rate.

### Setting the basket weights

For demurrage collateral, the prime basket weights are in units of January 1st 2020 collateral, not today's collateral. It doesn't matter if the collateral wasn't around in 2020 -- when setting the basket weights the setter must take into account how much demurrage has occurred since January 1st 2020.

For example, say an asset has had 5% total demurrage since January 1st 2020 and you want to (on today's date) create a basket of that is worth $1: the correct basket weight would be `1 / 0.95 = ~1.0526`.

To calculate total demurrage since 2020-01-01 00:00:00 UTC, use:

```
fee() ^ (seconds_since_2020_01_01)
```

(where `fee()` is the per-second demurrage rate, usually found on the `DemurrageCollateral` contract)
