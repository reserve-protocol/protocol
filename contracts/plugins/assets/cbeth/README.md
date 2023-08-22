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

`return _safeWrap(token.exchange_rate());`
