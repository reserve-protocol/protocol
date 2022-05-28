# Things in the Documentation Style

## Assets/Collateral

An ERC20 exists in our system wrapped in either an _Asset_ or _Collateral_ contract. The definition of an asset is very broad. Any ERC20 that can have a price in the unit of account (most likely USD) can be an asset. A collateral is a specific type of asset that enables an ERC20 to act as backing for an RToken.


# Some Input Ranges and Granularities

Minimum ranges for covering entire spans:

- Token balances: [0, 1e18] by 1e-18 steps: 128 bits
- RSR balances: [0, 1e29] qTokens: 104 bits
- Times in seconds: uint40 (maybe uint32 if it really helps?)

# System Tokens

## Token Balances

- `BackingManager`: Holds all backing for the RToken
- `RToken`: Holds collateral tokens during SlowIssuance
- `Furnace`: holds revenue RToken to be melted
- `stRSR`: holds staked RSR
- `RevenueTrader`: Holds and trades some asset A for either RSR or RToken for melting

## RToken Lifecycle

1. During SlowIssuance, the `RToken` transfers collateral tokens from the issuer's address into itself.
2. At vesting time, the `RToken` contract mints new RToken to the issuer and transfers the held collateral to the `BackingManager`. If the `BasketHandler` has updated the basket since issuance began, then the collateral is instead returned to the user and no RToken is minted.
3. During redemption, RToken is burnt from the redeemer's account and they are transferred a prorata share of backing collateral from the `BackingManager`.

# Deployment Parameters

## `maxTradeVolume`

{UoA}

The max trade volume is a value in the unit of account that represents the largest amount of value that should be transacted in any single trade. This value is distributed on deployment to the initial RSR, RToken, AAVE, and COMP assts. After deployment the values are allowed to differ.

Anticipated value: `1e6` = $1m

## `rewardPeriod`

{seconds}

The reward period is the length of one period of the StRSR and Furnace reward curves, which use exponential decay in order to hand out rewards slowly. The `rewardPeriod` must be set in conjuction with `rewardRatio` in order to achieve a desired payout rate. The `rewardPeriod` is the length of time that comprises a single period. Over a single period, `rewardRatio` of the last balance recorded is handed out. For multiple periods, the amount handed out is `(1 - (1-r)^N)`, where `r` is the `rewardRatio` and `N` is the number of periods elapsed.

Anticipated value: `86400` = 1 day

## `rewardRatio`

{%}

The `rewardRatio` is the amount of the current reward amount that should be handed out in a single period. See above.

Anticipated value: `0.02284e18` = causes the half life to occur at 30 periods

## `unstakingDelay`

{seconds}

The unstaking delay is the number of seconds that all RSR unstakings must be delayed in order to account for stakers trying to frontrun defaults. It may also be influenced by the length of governance votes.

Anticipated value: `1209600` = 2 weeks

## `tradingDelay`

{seconds}

The trading delay is how many seconds should pass after the basket has been changed, before a trade is opened. In the long-term this can probably trend towards zero but at the start we will want some heads up before trading in order to avoid losses due to poor liquidity.

Anticipated value: `14400` = 4 hours

## `auctionLength`

{seconds}

The auction length is how many seconds long Gnosis EasyAuctions should be.

Anticipated value: `900` = 15 minutes

## `backingBuffer`

{%}

The backing buffer is a percentage value that describes how much additional collateral tokens to keep in the BackingManager before forwarding tokens to the RevenueTraders. This helps cause collateral tokens to more reliably be converted into RToken, which is the most efficient form of revenue production.

Anticipated value: `0.0001e18` = 0.01%

## `maxTradeSlippage`

{%}

The max trade slippage is a percentage value that describes the maximum deviation from oracle prices that any trade can clear at.

Anticipated value: `0.01e18` = 1%

## `dustAmount`

{UoA}

The dust amount is a value in the unit of account that represents the smallest amount of value that it is worth executing a trade for. This parameter is a function of the strength of time preferences during recapitalization. It should be set such that the protocol is happy to accept donated assets and run a recapitalization auction with them, rather than proceed to RSR seizure.

Anticipated value: `1000e18` = $1,000

## `issuanceRate`

{%}

The issuance rate is a percentage value that describes what proportion of the RToken supply to issue per block. It controls how quickly the protocol can scale up RToken supply.

Anticipated value: `0.00025e18` = 0.025% per block
