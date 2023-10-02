# CBETH Collateral Plugin

## Summary

This plugin allows `CBETH` holders to use their tokens as collateral in the Reserve Protocol.

## Implementation

### Units

| tok   | ref  | target | UoA |
| ----- | ---- | ------ | --- |
| cbeth | ETH2 | ETH    | USD |

### Functions

#### refPerTok {ref/tok}

The L1 implementation (CBETHCollateral.sol) uses `token.exchange_rate()` to get the cbETH/ETH {ref/tok} contract exchange rate.

The L2 implementation (CBETHCollateralL2.sol) uses the relevant chainlink oracle to get the cbETH/ETH {ref/tok} contract exchange rate (oraclized from the L1).
