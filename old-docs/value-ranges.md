# Range of Values

This document is our policy for the ranges of values the protocol is intended to support.

The system should not revert due to overflow for any combination of values within the following ranges; any such reversion is an error.

Ranges here are formatted like "[min, max, granularity]" For instance, the range [0, 1e3, 1e-6] indicates the set of multiples of 1e-6 between 0 and 1000, inclusive. If a granularity isn't given, it's intended to be 1.


## Rates

- `{target/BU}` Weights in the prime basket: [0, 1e3, 1e-6]
- `{stRSR/rsr}` StRSR exchange rate: [1e-9, 1e9, 1e-9]
- `{BU/rTok}` RToken exchange rate: [1e-9, 1e9, 1e-9]
- `{UoA/target}` Collateral.pricePerTarget(): [1e-9, 1e9, 1e-9]
  - e.g UoA per USD
- `{target/ref}` Collateral.targetPerRef(): [1e-9, 1e9, 1e-9]
  - e.g USD per USDC
- `{ref/tok}` Collateral.refPerTok(): [1e-9, 1e9, 1e-9]
  - e.g USDC per cUSDC

## Token Quantities

- `{qRSR}` [0, 1e29]
- `{qStRSR}` [0, 1e38]
- `{qRTok}` [0, 1e48]
- `{qBU}` [0, 1e57]
- `{qTok}` of collateral tokens [0, 1e77]
- `{qTok}` of reward tokens [0, 1e29]


## Miscellaneous

### Units of Account

`{attoUoA}`, are expected in the range [0, 1e47]

That's 1e29 `UoA`. When UoA is USD, this is about 250x the _square_ of the current M2 money supply.

### Time

`{seconds}`: [0, 2^32-1]

That is, we expect timestamps to be any uint32 value.

This should work without change for a little under 100 years. With any luck, the gas costs involved in representing timestampts as uint40 will be more acceptable by then.
