# Prototype 0

This is Prototype 0, the _simplest_ version of our system we can possibly imagine.

## Architecture

- RToken: The stablecoin ERC-20 provided by the protocol. Holds ERC-20 details like metatransactions, but otherwise simple.
- StakingPool: An insurance staking pool that doubles as a tradeable ERC-20 staking derivative. Distributes RSR dividends and seizes RSR to pay for default.
- Manager: The coordinator of the entire system. Has authority over RToken and StakingPool. Performs auctions, detects default, and controls the exchange rate between RToken and BUs.
- Vault: Issues an accounting token called a BU (Basket Unit) and maintains an immutable basket definition. Multiple vaults per system.
- Faucet: Drips RToken back to the Manager at a slow rate.
- Oracle: Provides a simple unified interface for the Compound/Aave oracle.

### Token Balances

- Vault: holds exactly the collateral to back its own BU issuance
- Manager: holds RToken that is slow minting, and slush fund for collateral (ie intermediate location for collateral during vault migrations)
- Faucet: holds revenue RToken to be melted
- StakingPool: holds staked RSR

## Invariants

- The vault always holds sufficient backing for its outstanding BUs
- Only one auction is live at any given time
- ...more
