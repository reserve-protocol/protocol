# Range of Values

This doc serves as the source of truth for the ranges of values the protocol is intended to support. That is, it should be the case that the system does not revert for any combination of values within the following ranges. If we can find a case that causes a revert within these bounds, then the protocol is incorrectly implemented.

## Rates

Format: [min, max, granularity] - e.g. [0, 1e3, 1e-6] indicates 1e9 possible values between 0 and 1e3, inclusive

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

All of the below are in terms of quanta, or a granularity of 1.

- `{qRSR}`[0, 1e29]
- `{qStRSR}`[0, 1e38]
- `{qRTok}`[0, 1e48]
- `{qBU}`[0, 1e57]
- `{qTok}`[0, 1e77] (collateral tokens)
- `{qTok}` [0, 1e29] (reward tokens)

(similar to token quantities but not quite the same)

- `{attoUoA}` [0, 1e44] (1e26 `UoA`, or roughly the square of the current M2 money supply)

## Time

- `{seconds}` [0, 2^32]
  The current number of seconds since 1970 is ~1.6e9, which is about 37% of 2^32. We've got a little under a hundred years to upgrade this contract.
