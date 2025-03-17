# Midas Collateral Plugins

These plugins allow the Reserve Protocol to treat [Midas RWA](https://midas.app/) yield-bearing tokens as acceptable collateral backing for an RToken. They rely on Midas’s Data Feed contract to determine how many units of underlying value each token represents.

In this folder there are two contracts:

1. **MidasFiatCollateral** – For Midas tokens referencing a USD-based asset (e.g. `mTBILL`, `mBASIS`):

   - `{tok} = Midas Token`
   - `{ref} = {tok}` (the token itself)
   - `{target} = USD`
   - `{UoA} = USD`

2. **MidasNonFiatCollateral** – For Midas tokens referencing a non-fiat asset (e.g. `mBTC`):
   - `{tok} = mBTC`
   - `{ref} = BTC`
   - `{target} = BTC`
   - `{UoA} = USD`

Both contracts inherit from [`AppreciatingFiatCollateral`](../../AppreciatingFiatCollateral.sol). They ensure the reference exchange rate is non-decreasing, apply revenue-hiding, and default to `DISABLED` if that rate ever drops.

---

## MidasFiatCollateral

### Summary

- **Token** (`tok`): Midas yield-bearing token like `mTBILL`
- **Reference** (`ref`): Same as the token (appreciation tracked in `price()`)
- **Target** (`target`): USD
- **Unit of Account** (`UoA`): USD

`MidasFiatCollateral` reads the Midas Data Feed for `{USD/mToken}`. If that feed value shrinks between refresh calls, it will mark itself as `IFFY` or `DISABLED`.

### Key Methods

- **`underlyingRefPerTok()`** = 1 (since `{ref} = {tok}`)
- **`tryPrice()`**:
  - Reads the Midas Data Feed for `{USD/mToken}`.
  - Applies an `oracleError` margin for `[low, high]`.
  - Returns `pegPrice = 1` (indicating `{target/ref} = 1`).

### Blacklisting / Pausing

- **Blacklisted**: immediately `DISABLED`.
- **Paused**: `IFFY` → `DISABLED` if paused too long.

### Units Table

| `{tok}`             | `{ref}`       | `{target}` | `{UoA}` |
| ------------------- | ------------- | ---------- | ------- |
| mTBILL, mBASIS, etc | same as token | USD        | USD     |

---

## MidasNonFiatCollateral

### Summary

- **Token** (`tok`): e.g. `mBTC`
- **Reference** (`ref`): BTC
- **Target** (`target`): BTC
- **Unit of Account** (`UoA`): USD

`MidasNonFiatCollateral` uses the Data Feed for `{BTC/mToken}`, possibly combined with a Chainlink feed `{USD/BTC}` to get `{USD/mBTC}`. Any drop leads to `DISABLED`.

### Blacklisting / Pausing

- **Blacklisted**: immediately `DISABLED`.
- **Paused**: transitions `SOUND` → `IFFY`, and if persisted, `DISABLED`.

### Units Table

| `{tok}` | `{ref}` | `{target}` | `{UoA}` |
| ------- | ------- | ---------- | ------- |
| mBTC    | BTC     | BTC        | USD     |
