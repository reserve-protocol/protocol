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

### Collateral

* `forceUpdates` (Governance) **Review**
    - Baseline:
AavePricedFiatCollateral [23418, 69307, 65612] 
ATokenFiatCollateral     [23418, 78063, 40298/51043]
CTokenFiatCollateral     [23373, 63106, 45457/47114]

### Asset Registry

* `register` (Governance)
    - Baseline: [50334, 121502, 120720] 

* `swapRegistered` (Governance)
    - Baseline: [335663, 535751, 446472]
    - Mainly depends on `basketHandler.ensureBasket`

* `unregister` (Governance)
    - Baseline: [265345, 707275, 441443] 
    - Mainly depends on `basketHandler.ensureBasket`

* `forceUpdates` (Market Makers)
    - Baseline:  [225165] (when no action required - four assets)
    - Aggregator of `forceUpdates` on each collateral

### BackingManager

* `settleTrades` (Market Makers) **Review**
    - Baseline: [30485, 176540/196732]

* `manageFunds` (Market Makers) **Review**
    - Calls also `main.poke` which calls `settleTrades`
    - Baseline: [747693, 4196073/5585828]

* `grantAllowances` (Market Makers) **Review**
    - Baseline: [335250]

* `claimAndSweepRewards` (Market Makers) **Review**
    - Calls also `main.poke`
    - Baseline: [490303, 571746]


### BasketHandler

* `ensureBasket` (Governance/Market Makers)
    - Baseline: [304293, 885338, 521772]
    - Aggregator of `assetRegistry.forceUpdates()` and `switchBasket`

* `setPrimeBasket` (Governance) **Review**
    - Baseline: [57570, 406630, 171077]

* `switchBasket` (Governance/Market Makers) **Review**
    - Baseline  [148648, 763330, 315728]

### Broker and GnosisTrade

* `openTrade` (Market Makers) **Review**
    - Baseline: [1809980, 1820761, 1814739]
    - Target: `TBD`
    - Final Measurement `TBD`

*  `init` trade (Market Makers) **Review**
    - Baseline: [422366, 422366, 422366]

* `settle` trade (Market Makers) **Review**
    - Baseline: [116512, 133239, 123465]

### Distributor

* `distribute` (Market Makers) **Review**
    - Baseline: [90235, 90235, 90235] 

* `setDistribution` (Governance) **Review**
    - Baseline: [44100, 113597, 53459] 

### Furnace

* `init` (Governance)
    - Baseline: [141965, 181885, 168570]
    - Target: `TBD`
    - Final Measurement `TBD`

* `melt` (Market Makers)  **Review**
    - Baseline: [30452, 93050, 72166-78827]
    - Target: `TBD`
    - Final Measurement `TBD`

### Main

* `poke`  (Market Makers) **Review**
    - Baseline: [398979]
    - Aggregator of other functions
        
### RevenueTrader

* `settleTrades` (Market Makers) **Review**
    - Baseline: [30485, 199250/215417]

* `manageFunds` (Market Makers) **Review**
  - Calls also `main.poke` which includes `settleTrades`
  - Baseline: [545344, 2501014/2872593]

* `claimAndSweepRewards` (Market Makers) **Review**
    - Calls also `main.poke`
    - Baseline: [492814, 522568]

### RToken

* `claimAndSweepRewards` (Market Makers) **Review**
    - Calls also `main.poke`
    - Baseline: [499815, 529571]

* `issue` (Individuals/ Market Makers) **Review**
    - Baseline: [759837, 1363502, 1155332]

* `vest` (Individuals/ Market Makers) **Review**
    - Baseline: [408167, 750828, 481850]

* `redeem` (Individuals/ Market Makers) **Review**
    - Baseline: [746759, 934759, 794981]

* `cancel` (Individuals/ Market Makers) **Review**
    - Baseline: [34562, 130374, 110398]

* `transfer` (Individuals)
    - Baseline: [33679, 56475, 45803]

### StRSR

* `payoutRewards` (Market Makers) **Review**
    - Baseline: [ 69305, 104109, 80488]

* `transfer` (Individuals)
    - Baseline: [35192, 57092, 52304]

* `stake` (Individuals)
    - Baseline: [86422, 159269, 133636]

* `unstake` (Individuals)
    - Baseline: [423144, 502301, 471425]

* `withdraw` (Individuals)
    - Baseline: [336290, 416929, 404738]

* `seizeRSR` (Market Makers)
    - Baseline: [99363, 105857, 100912]


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

