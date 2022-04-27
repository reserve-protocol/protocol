# Gas Targets

This doc serves to classify the protocol functions and define acceptable gas targets for each of them. It also includes the initial gas measurements before doing any optimizations (baseline), and the final measurements after performing gas optimizations on the Production version. Gas optimizations and targets are defined for the Production version (P1).

- Format:
  - Baseline [min, max, average/common]
  - Target
  - Final Measurement [min, max, average/common]

## Classes

- Refreshers/Keepers (e.g. forceUpdates)
- Economic stabilization actions by whales (issuance, redemption, launching/settling auctions)
- Individual user actions (transfers, approvals, staking/unstaking)
- Governance actions (register assets, basket switching, configuring prime basket)
- Deployment/Upgrade

## Interfaces

### Deployer

- `deploy` (Governance) **Review**
  - Baseline: [9284946]

### Collateral

- `forceUpdates` (Many) **Review**
  - Baseline:
    - AavePricedFiatCollateral [23396, 67362, 57742]
    - ATokenFiatCollateral [23418, 76460, 50521]
    - CTokenFiatCollateral [23373, 63609, 47501]

### Asset Registry

- `register` (Governance)

  - Baseline: [50246, 121502, 120940]

- `swapRegistered` (Governance)

  - Baseline: [326698, 531997, 380595]
  - Mainly depends on `basketHandler.ensureBasket`

- `unregister` (Governance)

  - Baseline: [264179, 698522, 433002]
  - Mainly depends on `basketHandler.ensureBasket`

- `forceUpdates` (Market Makers) **Review**
  - Baseline: [207544] (when no action required - four assets)
  - Aggregator of `forceUpdates` on each collateral

### BackingManager

- `settleTrades` (Market Makers) **Review**

  - Baseline: [30508, 215617, 109382]

- `manageFunds` (Market Makers) **Review**

  - Calls also `forceUpdates()` and `settleTrades`
  - Baseline: [423404, 5719246, 2049536]

- `grantRTokenAllowance` (Market Makers) **Review**

  - Baseline: [362467]
  - Can be done for each specific asset only when required?

- `claimAndSweepRewards` (Market Makers) **Review**
  - Baseline: [184706, 474923, 255114]

### BasketHandler

- `ensureBasket` (Governance/Market Makers) **Review**

  - Baseline: [291598, 1114781, 615067]
  - Aggregator of `assetRegistry.forceUpdates()` and `switchBasket`

- `setPrimeBasket` (Governance) **Review**

  - Baseline: [57570, 570395, 257586]

- `switchBasket` (Governance/Market Makers) **Review**
  - Baseline [301208, 1263318, 672295]

### Broker and GnosisTrade

- `openTrade` (Market Makers) **Review**

  - Baseline: [2078983, 2089764, 2083742]
  - Final Measurement [514839, 525621, 522007]
  - Includes `trade.init`

- `init` trade (Market Makers) **Review**

  - Baseline: [423211, 423211, 423211]
  - Calls `gnosis.initiateAuction` which is out of our scope

- `settle` trade (Market Makers) **Review**
  - Baseline: [116512, 133239, 123465]

### Distributor

- `distribute` (Market Makers) **Review**

  - Baseline: [90235]

- `setDistribution` (Governance)
  - Baseline: [44100, 113597, 49806]

### Furnace

- `init` (Governance)

  - Baseline: [141965, 181885, 168570]
  - Final Measurement [117729, 137737, 131064]

- `melt` (Market Makers)
  - Baseline: [30452, 96981, 72809-83756]
  - Final Measurement [28396, 93267, 62627-75288]

### Main

- `poke` (Market Makers) **Review**
  - Baseline: [398979]
  - Aggregator of other functions

### RevenueTrader

- `settleTrades` (Market Makers) **Review**

  - Baseline: [30508, 199250/215417]

- `manageFunds` (Market Makers) **Review**

  - Calls also `main.poke` which includes `settleTrades`
  - Baseline: [545344, 2737994/2872593]

- `claimAndSweepRewards` (Market Makers) **Review**
  - Baseline: [492814, 522568]

### RToken

- `claimAndSweepRewards` (Market Makers) **Review**

  - Baseline: [499815, 529571]

- `issue` (Individuals/ Market Makers) **Review**

  - Baseline: [759837, 1363502, 1155332]
  - Calls `forceUpdates()` and `melt`

- `vest` (Individuals/ Market Makers) **Review**

  - Baseline: [408167, 750828, 481850]
  - Calls `forceUpdates()` and `melt`

- `redeem` (Individuals/ Market Makers) **Review**

  - Baseline: [746759, 934759, 794981]
  - Calls `forceUpdates()` and `melt`
  - Calls `grantRTokenAllowances()`

- `cancel` (Individuals/ Market Makers) **Review**

  - Baseline: [34562, 130374, 110398]

- `transfer` (Individuals)
  - Baseline: [33679, 56475, 45803]

### StRSR

- `payoutRewards` (Market Makers) **Review**

  - Baseline: [69305, 104109, 80488]

- `transfer` (Individuals)

  - Baseline: [35192, 57092, 52304]

- `stake` (Individuals)

  - Baseline: [86422, 159269, 133636]
  - Calls `payoutRewards`

- `unstake` (Individuals)

  - Baseline: [423144, 502301, 471425]
  - Calls `payoutRewards` and `assetRegistry.forceUpdates()`

- `withdraw` (Individuals)

  - Baseline: [336290, 416929, 404738]

- `seizeRSR` (Market Makers)
  - Baseline: [99363, 105857, 100912]

## Deployment Costs

- Baseline:
  - AavePricedFiatCollateral 1258480
  - AssetRegistryP1 2347379
  - ATokenFiatCollateral 1512175
  - BackingManagerP1 5744015
  - BasketHandlerP1 4125573
  - BrokerP1 2982722
  - CTokenFiatCollateral 1538977
  - DeployerP1 6695861
  - DistributorP1 1669152
  - FurnaceP1 1630722
  - MainP1 2228797
  - RevenueTradingP1 3332521
  - RTokenP1 5826929
  - StRSRP1 4318488
  - TradingLibP1 1992264
