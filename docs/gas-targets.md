# Gas Targets

This document serves to classify the protocol functions and define acceptable gas targets for each of them. It also includes the gas measurements for each of these functions in the Production version (P1)

- Format (Gas Costs):
  - Gas: [min, max, average]

## Classes

- Refreshers/Keepers (e.g. `forceUpdates`)
- Economic stabilization actions by whales (`issuance`, `redemption`, `launching/settling auctions`)
- Individual user actions (`transfers`, `approvals`, `staking/unstaking`)
- Governance actions (`register assets`, `basket switching`, `configuring prime basket`)
- Deployment/Upgrade

## Gas Costs

### Deployer

- `deploy` (Governance)
  - Gas: [4843637]

### Collateral

- `forceUpdates`
  - Gas:
    - AavePricedFiatCollateral [23395, 78546, 65227]
    - ATokenFiatCollateral [23395, 89772, 56274]
    - CTokenFiatCollateral [23417, 75058, 53482]

### Asset Registry

- `register` (Governance)
  - Gas: [87190, 175504, 174773]
- `swapRegistered` (Governance)

  - Gas: [359269, 511253, 389352]
  - Calls `basketHandler.forceUpdates`
  - Can trigger switch basket

- `unregister` (Governance)

  - Gas: [217296, 749472, 474155]
  - Calls `basketHandler.forceUpdates`
  - Can trigger switch basket

- `forceUpdates`
  - Gas: [193810, 575750, 372563] (reference: 4 tokens in basket)
  - Aggregator of `forceUpdates` on each collateral

### BackingManager

- `settleTrade`

  - Gas: [31257, 205038, 148871]

- `manageTokens`

  - Gas: [47495, 3196066, 1566374]
  - Calls `forceUpdates`
  - Triggers auctions

- `claimAndSweepRewards`
  - Gas: [225454, 541129, 297154]

### BasketHandler

- `refreshBasket`

  - Gas: [115120, 605216, 369841]
  - Can trigger switch basket

- `setPrimeBasket` (Governance)

  - Gas: [57228, 590605, 266086]

- `refreshBasket`
  - Gas [331098, 1329651, 716447]

### Broker and GnosisTrade

- `openTrade`

  - Gas: [518372, 529142, 523139]
  - Includes `trade.init`

- `init` trade

  - Gas: [430587]
  - Calls `gnosis.initiateAuction`

- `settle` trade
  - Gas: [114743, 131028, 121430]

### Distributor

- `distribute`

  - Gas: [93924]

- `setDistribution` (Governance)
  - Gas: [44070, 113567, 49776]

### Furnace

- `init` (Governance)

  - Gas: [118982, 138990, 132317]

- `melt`
  - Gas [28452, 80709, 60733]

### RevenueTrader

- `manageToken`

  - Gas: [49362, 985385, 524081]
  - Triggers auctions

- `claimAndSweepRewards`
  - Gas: [244517, 306066]

### RToken

- `issue`

  - Gas: [562655, 1645260, 960430]
  - Calls `forceUpdates` and `melt`

- `vest`

  - Gas: [346539, 1047371, 752171]
  - Calls `forceUpdates`

- `redeem`

  - Gas: [512864, 541664, 516982]
  - Calls `forceUpdates` and `refreshBasket`

- `cancel`

  - Gas: [46523, 142921, 122828]

- `transfer` (Individuals)
  - Gas: [34564, 56464]

### StRSR

- `stake` (Individuals)

  - Gas: [85941, 158788, 134784]
  - Calls `payoutRewards`

- `unstake` (Individuals)

  - Gas: [118022, 203689, 173293]
  - Calls `payoutRewards`

- `withdraw` (Individuals)

  - Gas: [476325, 537233, 521004]
  - Calls `forceUpdates`

- `payoutRewards`

  - Gas: [69130, 98607, 81777]

- `transfer` (Individuals)

  - Baseline: [35212, 57112]

- `seizeRSR` (Market Makers)
  - Baseline: [129593, 134440, 131261]

## Deployment Costs

- Gas:
  - AavePricedFiatCollateral: 1647534
  - AssetRegistryP1: 2247014
  - ATokenFiatCollateral: 1823787
  - BackingManagerP1: 4440543
  - BasketHandlerP1: 3768906
  - BrokerP1: 1511071
  - CTokenFiatCollateral: 1784274
  - DeployerP1: 2620070
  - DistributorP1: 1560163
  - FurnaceP1: 1525569
  - MainP1: 1740594
  - RevenueTraderP1: 2333403
  - RTokenP1: 5357520
  - StRSRP1: 4947202
  - TradingLibP1: 2819880
  - RewardableLibP1: 836069
