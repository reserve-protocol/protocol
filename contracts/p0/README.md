# Prototype 0

This is Prototype 0, the _simplest_ version of our system we can possibly imagine.


## Token Balances

- `Main`: Holds all backing for the RToken
- `RToken`: Holds RToken during SlowIssuance
- `Furnace`: holds revenue RToken to be melted
- `stRSR`: holds staked RSR
- `RevenueTrader`: Holds and trades some asset A for either RSR or RToken for melting

