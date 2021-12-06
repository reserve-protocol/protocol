# Prototype 0

This is Prototype 0, the _simplest_ version of our system we can possibly imagine.


## Token Balances

- `Main`: Holds BUs that back the RToken
- `RToken`: Holds RToken during SlowIssuance
- `Vault`: holds exactly the collateral to back its own BU issuance
- `Furnace`: holds revenue RToken to be melted
- `stRSR`: holds staked RSR
- `RevenueTrader`: Holds and trades all revenue tokens (RToken/COMP/AAVE)
- `BackingTrader`: Holds and trades all slush fund + temporary backing collateral

