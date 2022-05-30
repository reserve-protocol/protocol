# System Design

## Overview of Contract Architecture

The protocol is split into core contracts and plugins.

The _core_ contracts include `Main` and the other contracts (`Component`s) directly registered by `Main`. The core contracts all share governance and pausing status, they're all upgradable, and they form a single security domain.

The _plugin_ contracts are intended to be individual, static contracts that can be _registered_ with the core contracts. This includes the `Asset` and `Collateral` contracts that are registered in `AssetRegistry`, and `Trade` contracts that are selected and created by the `Broker`. Plugin contracts have only short-term state, are not individually puasable, and are not upgradable; if a plugin contract must be upgraded, it can simply be replaced.

Any ERC20 token that our system knows how to deal with is wrapped and modelled in an `Asset` or `Collateral` contract. An Asset models an ERC20 token, and provides a view of its price against the unit of account. A Collateral is an Asset with the further information our protocol requires to use its ERC20 as RToken backing.

The remained solidity files in our repository are either:

- `Facade.sol`, which is a practically stateless Facade for our system, for the convenience of external interactions and app development
- `Deployer.sol`, which deploys the clones of implementation contracts as needed to initialize a new RToken
- `Fixed.sol`, which provides fixed-point fractional arithmetic operations
- Mixins for the implementations of the other contracts in the system
- Mocks or stubs for testing

## Notes on Token Flow

### Tokens Held by Different Contracts

Some of the core contracts in our system regularly own ERC20 tokens. In each case, such tokens are intended for particular purposes:

- `BackingManager`: Holds all collateral tokens backing outstanding RToken
- `RToken`: Holds collateral tokens for RToken where issuance has begun but is not yet vested
- `Furnace`: Holds revenue RToken to be melted
- `stRSR`: Holds staked RSR
- `RevenueTrader`: Holds and trades some asset A for RSR (for stRSR rewards) or RToken (for melting)

### RToken Lifecycle

1. During SlowIssuance, the `RToken` transfers collateral tokens from the issuer's address into itself.
2. At vesting time, the `RToken` contract mints new RToken to the issuer and transfers the held collateral to the `BackingManager`. If the `BasketHandler` has updated the basket since issuance began, then the collateral is instead returned to the user and no RToken is minted.
3. During redemption, RToken is burnt from the redeemer's account and they are transferred a prorata share of backing collateral from the `BackingManager`.

## Basket Dynamics

(TODO: in progress; this should be more fully articulated before we release it!)

There are 3 types of baskets in our system:

1. Prime Basket (Configuration)
2. Reference Basket
3. Collateral Basket

Terminology

```
{BU} = basket unit
{target} = amount of a target unit
{ref} = amount of a reference unit
{tok} = amount of the collateral token itself
```

### Prime Basket

`{target/BU}`

The prime basket is the most fundamental of the three baskets. It is a definition of a `BU` in terms of `target` units, such as USD or EURO. The prime basket consists of a set of triples `<collateral token, target unit, target amount>`, such as `<cUSDC, USD, 0.33 cents>`.

The prime basket changes only through governance action.

### Reference Basket

`{ref/BU}`

The reference basket is the second most fundamental of the baskets. It is calculated from the prime basket whenever a token defaults, or governance triggers a switch manually. The reference basket should be worth the same number of `target` units as the prime basket. It consists of a set of triples `<collateral token, reference unit, reference amount>`, such as `<cUSDC, USDC, 0.33>`.

### Collateral Basket

`{tok/BU}`

The collateral basket is the most dynamic of the baskets. You can think of it like a view of the reference basket given particular defi redemption rates. If a collateral token appreciates, the quantity of that token in the collateral basket is decreased in order to keep the total number of reference amounts in the basket constant. It consists of a set of pairs `<collateral token, token quantity>`, such as `<cUSDC, O.29>`.

This is the form of the basket that issuers and redeemer will care most about. Issuance and redemption quantities are given by the collateral basket times the `rTok/BU` exchange rate.

Since defi redemption rates can change every block, so can the collateral basket. As an issuance is pending in the mempool, the quantities of tokens that will be ingested when the tx is mined decreases slightly as the collateral becomes worth more. If furnace melting happens in that time, however, this can increase the quantity of collateral tokens in the basket and cause the issuance to fail.

And the flip side: as a redemption is pending in the mempool the quantities of collateral tokens the redeemer will receive steadily decreases. If a furnace melting happens in that time the quantities will be increased, causing the redeemer to get more than they expected.

## Deployment Parameters

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

## oneshotPauseDuration

{s}

The number of seconds a oneshot pause should last. That is, a pause performed by the pauser role, which can only be used once. The owner can pause indefinitely.

Anticipated value: `864000` = 10 days

## minBidSize

{UoA}

The minimum bid size in a dutch auction (such as Gnosis EasyAuction) in terms of the unit of account. This prevents auction bidders from performing gas-griefing attacks against the protocol.

Antipicated value: `1e18` = $1
