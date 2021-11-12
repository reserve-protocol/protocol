# Prototype 0

This is Prototype 0, the _simplest_ version of our system we can possibly imagine.

## Architecture

Prototype 0 uses a hub-and-spoke model. There is a central coordinator called `Main` that holds system-wide state as well as holds handles for all modules. `Main` may have elevated privileges over modules. Modules should not be allowed to even mutate `Main`. Modules should not have elevated privileges over modules, for the most part, though there is a single exception in the `AssetManager`-`stRSR` relationship so that RSR can be seized.

- `Main`: The main coordinator of the entire system of contracts. Holds configuration of the system as well as global system state. Has elevated privileges on all modules.

- `RToken` Module: The stablecoin ERC-20 provided by the protocol. Holds ERC-20 details like metatransactions, and allows the `AssetManager` to burn/mint, but otherwise simple.
- `stRSR` Module: A rebasing ERC-20 stRSR derivative token that allows the `AssetManager` to seize RSR, as well as hands out RSR dividends.
- `AssetManager` Module: Manages assets and performs auctions.
- `DefaultMonitor` Module: Monitors for default.
- `Furnace` Module: Permisionless. Accepts batches to be burnt over a time period and block-by-block allows burning.

- `Asset`: Immutable wrapper-contracts for cTokens/aTokens/governance rewards/RToken/RSR/fiatcoins. Provides a single interface for the rest of the system to use.
- `Vault` (data of AssetManager): Issues an accounting token called a BU (Basket Unit) and maintains an immutable basket definition. Multiple vaults per system, connected by an implicit overall DAG.

## Token Balances

- `Main`: Holds BUs during SlowIssuance, which it then transfers to the `AssetManager` upon successful vesting.
- `Vault`: holds exactly the collateral to back its own BU issuance
- `AssetManager`: holds revenue RToken from supply expansion as well as acts as a slush fund for collateral (ie it is the intermediate location for collateral during vault migrations). Also holds BUs to back the RToken supply.
- `Furnace`: holds revenue RToken to be melted
- `stRSR`: holds staked RSR

## Invariants

- The vault always holds sufficient backing for its outstanding BUs
- Modules cannot mutate `Main`
- ...more
