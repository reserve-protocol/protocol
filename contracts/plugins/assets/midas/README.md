# Midas Collateral Plugin (mBTC, mTBILL, mBASIS)

## Overview

This collateral plugin integrates Midas tokens (mBTC, mTBILL, mBASIS) into the Reserve Protocol as collateral. It supports both BTC-based and USD-based targets:

- **mBTC (BTC-based):**
    - `{target}=BTC`, `{ref}=BTC`, so `{target/ref}=1`.
    - A Chainlink feed provides `{UoA/target}=USD/BTC`.
    - `price(UoA/tok) = (USD/BTC)*1*(BTC/mBTC) = USD/mBTC`.

- **mTBILL, mBASIS (USD-based):**
    - `{target}=USD`, `{ref}=USDC(≈USD)`, so `{target/ref}=1`.
    - Since `{UoA}=USD` and `{target}=USD`, `{UoA/target}=1` directly, no external feed needed.
    - `price(UoA/tok)=1*1*(USDC/mToken)=USD/mToken`.

This plugin uses a Midas data feed (`IMidasDataFeed`) to obtain `{ref/tok}`, and leverages `AppreciatingFiatCollateral` to handle revenue hiding and immediate defaults if `refPerTok()` decreases.

### Socials
-   Telegram: https://t.me/midasrwa
-   Twitter (X): https://x.com/MidasRWA

## Units and Accounting

### mBTC Units

|            | Unit    |
|------------|---------|
| `{tok}`    | mBTC    |
| `{ref}`    | BTC     |
| `{target}` | BTC     |
| `{UoA}`    | USD     |

### mTBILL / mBASIS Units

|            | Unit             |
|------------|------------------|
| `{tok}`    | mTBILL or mBASIS |
| `{ref}`    | USDC (≈USD)      |
| `{target}` | USD              |
| `{UoA}`    | USD              |


All scenarios: `{target/ref}=1`.

## Key Points

- For mBTC: Requires a Chainlink feed for `{UoA/target}` (USD/BTC).
- For mTBILL/mBASIS: `{UoA/target}=1`, no Chainlink feed needed.
- On pause: transitions collateral to `IFFY` then `DISABLED` after `delayUntilDefault`.
- On blacklist: immediately `DISABLED`.
- If `refPerTok()` ever decreases: immediately `DISABLED`.
- Uses `AppreciatingFiatCollateral` for smoothing small dips in `refPerTok()` (revenue hiding of 10 bps).

## References

The Midas Collateral plugin interacts with several Midas-specific contracts and interfaces

### IMidasDataFeed
- **Purpose**: Provides the `{ref/tok}` exchange rate (scaled to 1e18) for Midas tokens.
- **Usage in Plugin**: The collateral plugin calls `getDataInBase18()` to fetch a stable reference rate.
- **Examples**:
    - mBTC Data Feed: [0x9987BE0c1dc5Cd284a4D766f4B5feB4F3cb3E28e](https://etherscan.io/address/0x9987BE0c1dc5Cd284a4D766f4B5feB4F3cb3E28e)
    - mTBILL Data Feed: [0xfCEE9754E8C375e145303b7cE7BEca3201734A2B](https://etherscan.io/address/0xfCEE9754E8C375e145303b7cE7BEca3201734A2B)

### IMToken (mBTC, mTBILL)
- **Purpose**: Represents Midas tokens as ERC20 with additional pause/unpause features.
- **Examples**:
    - mBTC: [0x007115416AB6c266329a03B09a8aa39aC2eF7d9d](https://etherscan.io/address/0x007115416AB6c266329a03B09a8aa39aC2eF7d9d)
    - mTBILL: [0xDD629E5241CbC5919847783e6C96B2De4754e438](https://etherscan.io/address/0xDD629E5241CbC5919847783e6C96B2De4754e438)

## Price Calculation

`price(UoA/tok) = (UoA/target) * (target/ref) * (ref/tok)`

- mBTC: `(UoA/target)=USD/BTC` (from Chainlink), `(ref/tok)=BTC/mBTC` → `USD/mBTC`.
- mTBILL/mBASIS: `(UoA/target)=1`, `(ref/tok)=USDC/mToken` (≈USD/mToken) → `USD/mToken`.

## Pre-Implementation Q&A

1. **Units:**

   - `{tok}`: Midas token
   - `{ref}`: mBTC -> BTC, mTBILL/mBASIS -> USDC(≈USD)
   - `{target}`: mBTC -> BTC, mTBILL/mBASIS -> USD
   - `{UoA}`: USD

2. **Wrapper needed?**  
   No. Midas tokens are non-rebasing standard ERC-20 tokens. No wrapper is required.

3. **3 Internal Prices:**

   - `{ref/tok}` from `IMidasDataFeed`
   - `{target/ref}=1`
   - `{UoA/target}`:
     - mBTC: from Chainlink (USD/BTC)
     - mTBILL/mBASIS: 1

4. **Trust Assumptions:**

   - Rely on Chainlink feeds for USD/BTC (mBTC case).
   - Assume stable `{UoA/target}=1` for USD-based tokens.
   - Trust `IMidasDataFeed` for `refPerTok()`.

5. **Protocol-Specific Metrics:**

   - Paused => IFFY => DISABLED after delay
   - Blacklisted => DISABLED immediately
   - `refPerTok()` drop => DISABLED

6. **Unique Abstractions:**

   - One contract supports both BTC and USD targets with conditional logic.
   - Revenue hiding to smooth tiny dips.

7. **Revenue Hiding Amount:**
   A small value like `1e-4` (10 bps) recommended and implemented in constructor parameters.

8. **Rewards Claimable?**
   None. Yield is through `refPerTok()` appreciation.

9. **Pre-Refresh Needed?**
   No, just `refresh()`.

10. **Price Range <5%?**
    Yes, controlled by `oracleError`. For USD tokens, it's trivial. For BTC tokens, depends on Chainlink feed quality.

## Configuration Parameters

When deploying `MidasCollateral` you must provide:

- `CollateralConfig` parameters:
    - `priceTimeout`: How long saved prices remain relevant before decaying.
    - `chainlinkFeed` (for mBTC): The USD/BTC Chainlink aggregator.
    - `oracleError`: Allowed % deviation in oracle price (0.5%).
    - `erc20`: The Midas token’s ERC20 address.
    - `maxTradeVolume`: Max trade volume in `{UoA}`.
    - `oracleTimeout`: Staleness threshold for the `chainlinkFeed`.
    - `targetName`: "BTC" or "USD" as bytes32.
    - `defaultThreshold`: 0
    - `delayUntilDefault`: How long after `IFFY` state to become `DISABLED` without recovery.

- `revenueHiding`: Small fraction to hide revenue (e.g., `1e-4` = 10 bps).
- `refPerTokFeed`: The `IMidasDataFeed` providing `{ref/tok}`.
- `refPerTokTimeout_`: Timeout for `refPerTokFeed` validity (e.g., 30 days).


## Testing

```bash
yarn hardhat test test/plugins/individual-collateral/midas/mbtc.test.ts
yarn hardhat test test/plugins/individual-collateral/midas/mtbill.test.ts
```
