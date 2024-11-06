# Collateral Plugin - Stader - ETHx

## Summary

This plugin allows `ETHx` holders use their tokens as collateral in the Reserve Protocol.

## Implementation

### Units

| tok  | ref  | target | UoA |
| ---- | ---- | ------ | --- |
| ETHx | ETH2 | ETH    | USD |

### refPerTok()

Gets the exchange rate for `ETHx` to `ETH2` from the ETHx token contract using the [getExchangeRate()]()
function. This is the rate used by stader labs when converting between ethx and eth2 and is closely followed by secondary markets.
While the value of ETH2/ETHx **should** be only-increasing, it is possible that slashing or inactivity events could occur for the ETHx
validators. As such, `ETHx` inherits `AppreciatingFiatCollateral` to allow for some amount of revenue-hiding. The amount of
revenue-hiding should be determined by the deployer, but can likely be quite high, as it is more likely that any dips, however large,
would be temporary, and, in particularly bad instances, be covered by the Stader protocol.

### claimRewards()

There are no rewards to claim from ETHx.
