# Gas Targets

This doc serves to classify the protocol functions and define acceptable gas targets for each of them. It also includes the initial gas measurements before doing any optimizations (baseline), and the final measurements after performing gas optimizations on the Production version. Gas optimizations and targets are defined for the Production version (P1).


* Format:
    - Baseline [min, max, average/common]
    - Target
    - Final Measurement [min, max, average/common]

## User Profiles

- Governance
- Market Makers - Defi Integration
- Market Makers - Trading
- Individuals


## Interfaces

### Assets/Collateral

* `forceUpdates` (Governance) **Review**
    - Baseline:
AavePricedFiatCollateral [23418, 69307,58158] 
ATokenFiatCollateral     [23418, 78063, 53729]
CTokenFiatCollateral     [23373, 63106, 47529]


### Asset Registry

* `init` (Governance) **Review**

* `register` (Governance)
    - Baseline: [50334, 121502, 120720] 

* `swapRegistered` (Governance) **Review**
    - Baseline: [335663, 535751, 446472]

* `unregister` (Governance) **Review**
    - Baseline: [265345, 707275, 441443] 

* `forceUpdates` (Market Makers)  **Review**
    - Baseline: [225165, 252490, 251662]

### BackingManager

* `init` (Governance) **Review**

* `settleTrades` (Market Makers) **Review**

* `manageFunds` (Market Makers) **Review**

* `claimAndSweepRewards` (Market Makers) **Review**
    - Baseline: [400859, 554414, 525629]

### BasketHandler

* `ensureBasket` (Governance/Market Makers) **Review**
    - Baseline: [304293, 885338, 521772]

* `setPrimeBasket` (Governance) **Review**
    - Baseline: [57570, 406630, 171077]

* `switchBasket` (Governance/Market Makers) **Review**
    - Baseline  [148648, 763330, 315728]

### Broker

* `openTrade` (Market Makers) **Review**
    - Baseline: [1809980, 1820761, 1814739]
    - Target: `TBD`
    - Final Measurement `TBD`

### Distributor

* `init` (Governance) **Review**

* `distribute` (Market Makers) **Review**
    - Baseline: [90235, 90235, 90235] 

* `setDistribution` (Governance) **Review**
    - Baseline: [44100, 113597, 53459] 


### Furnace

* `init` (Governance) **Review**
    - Baseline: [141965, 181885, 168570]
    - Target: `TBD`
    - Final Measurement `TBD`

* `melt` (Market Makers)  **Review**
    - Baseline: [30452, 93050, 72166-78827]
    - Target: `TBD`
    - Final Measurement `TBD`

### Gnosis Trade

* `init` (Market Makers) **Review**
    - Baseline: [422366, 422366, 422366]

* `settle` (Market Makers) **Review**
    - Baseline: [117822, 133239, 128100]

### Main

* `poke`  (Market Makers) **Review**

### RevenueTrader

* `init` (Market Makers) **Review**

* `settleTrades` (Market Makers) **Review**

* `manageFunds` (Market Makers) **Review**

* `claimAndSweepRewards` (Market Makers) **Review**

### RToken

* `init` (Governance) **Review**

* `claimAndSweepRewards` (Market Makers) **Review**

* `issue` (Individuals/ Market Makers) **Review**

* `vest` (Individuals/ Market Makers) **Review**

* `redeem` (Individuals/ Market Makers) **Review**

* `cancel` (ndividuals/ Market Makers) **Review**

* `transfer` (Individuals)

### StRSR

* `init` (Governance) **Review**

* `payoutRewards` (Market Makers) **Review**

* `transfer` (Individuals)

* `stake` (Individuals)

* `unstake` (Individuals)

* `withdraw` (Individuals)

* `seizeRSR` (Market Makers)


## Deployment Costs

* Baseline:
    - AavePricedFiatCollateral   1258480 
    - AssetRegistryP1            2347379
    - ATokenFiatCollateral       1512175 
    - BackingManagerP1           5744015
    - BasketHandlerP1            4125573
    - BrokerP1                   2982722 
    - CTokenFiatCollateral       1538977 
    - DeployerP1                 6695861
    - DistributorP1              1669152
    - FurnaceP1                  1630722
    - MainP1                     2228797
    - RevenueTradingP1           3332521
    - RTokenP1                   5826929 
    - StRSRP1                    4318488
    - TradingLibP1               1992264

