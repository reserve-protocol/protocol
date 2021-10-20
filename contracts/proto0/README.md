# Prototype 0

This is Prototype 0, the _simplest_ version of our system we can possibly imagine.

## Architecture

TODO: More

### Token Balances

- Vault: holds exactly the collateral to back its own BU issuance
- Manager: holds RToken that is slow minting, and slush fund for collateral (ie intermediate location for collateral during vault migrations)
- Faucet: holds revenue RToken to be melted
- StakingPool: holds staked RSR
