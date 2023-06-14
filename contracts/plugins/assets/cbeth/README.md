# CBETH Collateral Plugin

## Summary

This plugin allows `CBETH` holders to use their tokens as collateral in the Reserve Protocol.

## Implementation

### Units

| tok    | ref | target | UoA |
| ----   | --- | ------ | --- |
| wcbeth | ETH | ETH    | ETH |

### Functions

#### refPerTok {ref/tok}

`return shiftl_toFix(token.exchange_rate(), -18);`
