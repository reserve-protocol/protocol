# System Design

## Overview of Contract Architecture

The protocol is split into core contracts and plugins.

The _core_ contracts include `Main` and the other contracts (`Component`s) directly registered by `Main`. The core contracts all share governance and pausing status, they're all upgradable, and they form a single security domain.

The _plugin_ contracts are intended to be individual, static contracts that can be _registered_ with the core contracts. This includes the `Asset` and `Collateral` contracts that are registered in `AssetRegistry`, and `Trade` contracts that are selected and created by the `Broker`. Plugin contracts have only short-term state, are not individually puasable, and are not upgradable; if a plugin contract must be upgraded, it can simply be replaced.

Any ERC20 token that our system knows how to deal with is wrapped and modelled in an `Asset` or `Collateral` contract. An Asset models an ERC20 token, and provides a view of its price against the unit of account. A Collateral is an Asset with the further information our protocol requires to use its ERC20 as RToken backing.

The remained solidity files in our repository are either:

- `Facade.sol`, which is a stateless generic interface that can be used with any RToken. This enables convenient external interactions and app development. There can be multiple facades.
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

## Some Monetary Units

Our system refers to units of financial value in a handful of different ways, and treats them as different dimensions. Some of these distinctions may seem like splitting hairs if you're just thinking about one or two example RTokens, but the differences are crucial to understanding how the protocol works in a wide variety of different settings.

Some units:

- Unit of Account `{UoA}`: Any particular RToken must have a single Unit of Account. This unit is used internally to compare the values of different assets, as when deciding when there's enough revenue to start an auction, or in which of several surplus assets we hold the largest surplus.

- Target unit `{target}`: Outside of default, each collateral in an RToken basket is expected to be stable or appreciating against some exogenous currency. The exogenous currency is that collateral's _target unit_. We expect that in many RTokens that people actually want, all of those target units will be the same, and we can speak of the RToken maintaining stability or appreciation against _its_ target unit.

- Reference unit `{ref}`: When collateral tokens are expected to appreciate, it's generally because some defi protocol (or protocols) produces a token that is freely redeemable for some base token, and that redemption rate is expected to monotonically increase over time. That base token is the _reference unit_ for the collateral token. The RToken protocol expects reference units to be in a known, predictable relationship with target units, and will flag a collateral token as defaulting if that relationship appears to be broken.

- Token `{tok}`: An token that our protocol holds a balance of, mostly as backing for the RToken.

A couple examples:

- In the USD+ RToken we have designed, the unit of account is USD. Among others, cUSDC is a collateral token with reference unit USDC and target unit USD, and aUSDP is a collateral token with reference token USDP and target unit USD.

- Let's say we're building a pure-stable USD basket, out of USDC, USDP, and DAI. The unit of account would surely be USD. Each collateral token would also be its own reference unit, and its target would be USD.

Separate from these, a number in dimension `{BU}` ("basket units") is an amount of current baskets.

## Basket Dynamics

There are 3 types of baskets in our system:

1. Prime Basket (Configuration parameter, changed only by governance action)
2. Reference Basket (Contract state, changes rarely)
3. Collateral Basket (Dynamic value)

### Prime Basket

The prime basket is directly set by governance, and only changes when governance demands it. The prime basket consists of a set of triples `<collateral token, target unit, target amount>`. Each triple means that, in each basket unit, `target amount` of the `target unit` should be represented by `collateral token`.

The dimension of `target amount` is `{target / BU}`.

For example, if the prime basket contains the triple `<cUSDC, USD, 0.33>`, that means "The configured system should contain 0.33 USD/BU, as represented by cUSDC".

As a consequence, the prime basket also defines the quantity of each target unit that's intended to be represented by one basket; altogether, these pairs `<target unit, target amount>` form the _target basket_. The target basket isn't used explicitly anywhere in our code, but it's a useful property of a proposed RToken. (e.g, "A target basket of 1 USD, 1 EUR, and 1/1000th ETH".)

### Reference Basket

Whenever the BasketHandler derives a new concrete basket from the prime basket (by calling `BasketHandler._switchBasket()`), the persistent value it saves is the _reference basket_. (This happens whenever a token defaults, or governance manually requests a switch.)

A reference basket is a set of triples `<collateral token, reference unit, reference amount>`. Each triple means that each basket unit must contain an amount of `collateral token` currently equivalent to `reference amount` of the `reference unit`.

The dimension of `reference amount` is `{ref/BU}`.

For example, if the reference basket contains the triple `<cUSDC, USDC, 0.33>`, then one basket unit should contain whatever amount of cUSDC is redeemable in its protocol for 0.33 USDC.

### Collateral Basket

The collateral basket is derived, moment-by-moment and on-demand, from the reference basket. Since defi redemption rates can change every transaction, so can the collateral basket. The collateral basket is a set of pairs `<collateral token, token amount>`. Each pair means that each basket unit must contain `token amount` of `collateral token`.

The dimension of `token amount` is `{tok/BU}`.

For instance, if the reference basket contains the pair `<cUSDC, O.29>`, then one basket unit will contain 0.29 cUSDC.

This is the form of the basket that issuers and redeemer will care most about. Issuance and redemption quantities are given by the collateral basket times the current `rTok/BU` exchange rate.

While an issuance is pending in the mempool, the quantities of tokens that will be ingested when the transaciton is mined may decrease slightly as the collateral becomes worth more. If furnace melting happens in that time, however, this can increase the quantity of collateral tokens in the basket and cause the issuance to fail.

On the other hand, while a redemption is pending in the mempool, the quantities of collateral tokens the redeemer will receive steadily decreases. If a furnace melting happens in that time the quantities will be increased, causing the redeemer to get more than they expected.

## Deployment Parameters

### `maxTradeVolume`

Dimension: `{UoA}`

In general the max trade volume is a value in the unit of account that caps how many tokens are traded at once. Generally each asset plugin has its own `maxTradeVolume`, and both assets that are part of the trade participate to constrain trade volume. However, in this case the deployment parameter is just for the RToken asset. At deployment-time the RSR asset is already immutably deployed and it is up to the user to specify `maxTradeVolume` for further individual collateral deployments.

Anticipated value: `1e6` = $1m
Reasonable range: 1e21 to 1e27. Definitely increase this as the RToken grows.

### `rewardPeriod`

Dimension: `{seconds}`

The reward period is the length of one period of the StRSR and Furnace reward curves, which use exponential decay in order to hand out rewards slowly. The `rewardPeriod` must be set in conjuction with `rewardRatio` in order to achieve a desired payout rate. The `rewardPeriod` is the length of time that comprises a single period. Over a single period, `rewardRatio` of the last balance recorded is handed out. For multiple periods, the amount handed out is `(1 - (1-r)^N)`, where `r` is the `rewardRatio` and `N` is the number of periods elapsed.

Anticipated value: `86400` = 1 day
Reasonable range: 10 to 31536000 (1 year)

### `rewardRatio`

Dimension: `{%}`

The `rewardRatio` is the amount of the current reward amount that should be handed out in a single period. See above.

Anticipated value: `0.02284e18` = half life of 30 periods
Reasonable range: 1e9 to 1e18

### `unstakingDelay`

Dimension: `{seconds}`

The unstaking delay is the number of seconds that all RSR unstakings must be delayed in order to account for stakers trying to frontrun defaults. It may also be influenced by the length of governance votes.

Anticipated value: `604800` = 1 week
Reasonable range: 1 to 31536000

### `tradingDelay`

Dimension: `{seconds}`

The trading delay is how many seconds should pass after the basket has been changed, before a trade is opened. In the long term this can probably trend towards zero, but at the start we will want some heads up before trading in order to avoid losses due to poor liquidity.

Anticipated value: `14400` = 4 hours
Reasonable range: 0 to 604800

### `auctionLength`

Dimension: `{seconds}`

The auction length is how many seconds long Gnosis EasyAuctions should be.

Anticipated value: `900` = 15 minutes
Reasonable range: 60 to 3600

### `backingBuffer`

Dimension: `{%}`

The backing buffer is a percentage value that describes how much additional collateral tokens to keep in the BackingManager before forwarding tokens to the RevenueTraders. This helps cause collateral tokens to more reliably be converted into RToken, which is the most efficient form of revenue production.

Anticipated value: `1e14` = 0.01%
Reasonable range: 1e12 to 1e18

### `maxTradeSlippage`

Dimension: `{%}`

The max trade slippage is a percentage value that describes the maximum deviation from oracle prices that any trade can clear at.

Anticipated value: `0.01e18` = 1%
Reasonable range: 1e12 to 1e18

### `dustAmount`

Dimension: `{UoA}`

The dust amount is a value in the unit of account that represents the smallest amount of value that it is worth executing a trade for. This parameter is a function of the strength of time preferences during recapitalization. It should be set such that the protocol is happy to accept donated assets and run a recapitalization auction with them, rather than proceed to RSR seizure.

Anticipated value: `1000e18` = $1,000
Reasonable range: 1e18 to 1e24

### `issuanceRate`

Dimension: `{%}`

The issuance rate is a percentage value that describes what proportion of the RToken supply to issue per block. It controls how quickly the protocol can scale up RToken supply.

Anticipated value: `0.00025e18` = 0.025% per block
Reasonable range: 1e12 to 1e16

### `oneshotFreezeDuration`

Dimension: `{s}`

The number of seconds a freeze performed by a non-governance freezer. Governance can freeze indefinitely.

Anticipated value: `864000` = 10 days
Reasonable range: 3600 to 31536000

### `minBidSize`

Dimension: `{UoA}`

The minimum bid size in a dutch auction (such as Gnosis EasyAuction) in terms of the unit of account. This prevents auction bidders from performing gas-griefing attacks against the protocol.

Antipicated value: `1e19` = $10
Reasonable range: 1e18 to 1e24
