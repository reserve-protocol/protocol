# Prototype 0

This is Prototype 0, the _simplest_ version of our system we can possibly imagine.

## Architecture

TODO: More

### Token Balances

- Vault: holds exactly the collateral to back its own BU issuance
- RToken: extra collateral tokens held that do not fit in a BU
- Manager: slow minting collateral tokens
- Faucet: holds revenue RToken to be melted
- StakingPool: holds staked RSR
