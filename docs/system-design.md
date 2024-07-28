# System Design

## Overview of Contract Architecture

The protocol is split into core contracts and plugins.

The _core_ contracts include `Main` and the other contracts (`Component`s) directly registered by `Main`. The core contracts all share governance and pausing status, they're all upgradable, and they form a single security domain.

The _plugin_ contracts are intended to be individual, static contracts that can be _registered_ with the core contracts. This includes the `Asset` and `Collateral` contracts that are registered in `AssetRegistry`, and `Trade` contracts that are selected and created by the `Broker`. Plugin contracts have only short-term state, are not individually pausable, and are not upgradable; if a plugin contract must be upgraded, it can simply be replaced.

Any ERC20 token that our system knows how to deal with is wrapped and modelled in an `Asset` or `Collateral` contract. An Asset models an ERC20 token, and provides a view of its price against the unit of account. A Collateral is an Asset with the further information our protocol requires to use its ERC20 as RToken backing.

The remained solidity files in our repository are either:

- `Facade.sol` and `FacadeAct.sol`, which is a stateless generic interface that can be used with any RToken. This enables convenient external interactions and app development. There can be multiple facades.
- `FacadeWrite.sol`, which allows to easily deploy and configure an RToken in a few simple transactions.
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

1. During minting, the `RToken` transfers collateral tokens from the caller's address into itself and mints new RToken to the caller's address. Minting amount must be less than the current throttle limit, or the transaction will revert.
2. During redemption, RToken is burnt from the redeemer's account and they are transferred a prorata share of backing collateral from the `BackingManager`.

## Protocol Assumptions

### Blocktime = 12s

The protocol (weakly) assumes a 12-second blocktime. This section documents the places where this assumption is made and whether changes would be required if blocktime were different.

#### Should-be-changed if blocktime different

- The `Furnace` melts RToken in periods of 12 seconds. If the protocol is deployed to a chain with shorter blocktime, it is possible it may be rational to issue right before melting and redeem directly after, in order to selfishly benefit. The `Furnace` should be updated to melt more often.

#### Probably fine if blocktime different

- `DutchTrade` price curve can handle 1s blocktimes as-is, as well as longer blocktimes
- The `StRSR` contract hands out RSR rewards in periods of 12 seconds. Since the unstaking period is usually much larger than this, it is fine to deploy StRSR to another chain without changing anything, with shorter or longer blocktimes
- `BackingManager` spaces out same-kind auctions by 12s. No change is required is blocktime is less; some change required is blocktime is longer

## Some Monetary Units

Our system refers to units of financial value in a handful of different ways, and treats them as different dimensions. Some of these distinctions may seem like splitting hairs if you're just thinking about one or two example RTokens, but the differences are crucial to understanding how the protocol works in a wide variety of different settings.

Some units:

- Unit of Account `{UoA}`: Any particular RToken must have a single Unit of Account. This unit is used internally to compare the values of different assets, as when deciding when there's enough revenue to start an auction, or in which of several surplus assets we hold the largest surplus.

- Target unit `{target}`: Outside of default, each collateral in an RToken basket is expected to be stable or appreciating against some exogenous unit. The exogenous unit is that collateral's _target unit_. We expect that in many RTokens that people actually want, many of the target units will be the same, and we can speak of the RToken maintaining stability or appreciation against a linear combination of target units.

- Reference unit `{ref}`: When collateral tokens are expected to appreciate, it's generally because some defi protocol (or protocols) produces a token that is freely redeemable for some base token, and that redemption rate is expected to monotonically increase over time. That base token is the _reference unit_ for the collateral token. The RToken protocol expects reference units to be in a known, predictable relationship with target units, and will flag a collateral token as defaulting if that relationship appears to be broken.

- Token `{tok}`: A token that our protocol holds a balance of, mostly as backing for the RToken.

Some examples:

- For a Compound collateral token such as cUSDC, the unit of account is USD, the reference unit USDC and target unit USD.
- For an Aave collateral token such as aUSDP, the unit of account is USD, the reference token USDP and target unit USD.

- Let's say we're building a pure-stable USD basket, out of USDC, USDP, and DAI. The unit of account would surely be USD. Each collateral token would also be its own reference unit, and its target would be USD.

- Perhaps we're interested in a USD-denominated basket of blue-chip cryptocurrencies. This type of rToken could be a 50/50 basket of wstETH and yvwBTC, where the reference units could be ETH and wBTC, respectively. The target units would then be ETH & BTC, while the `{UoA}` would be USD. Thus, the _value_ of the rToken would fluctuate (according to its unit-of-account), but all other necessary properties could be maintained.

Separate from these, a number in dimension `{BU}` ("basket units") is an amount of current baskets.

### Regarding `{UoA}` and `{target}`

While it will usually be the case that a collateral's `{target}` will be the same as its RToken's `{UoA}`, this is by no means a requirement. The `{UoA}` is a way to value the RToken and its collateral in terms of a single unit, while each collateral's `{target}` is the expected value of its liability, or its `{ref}`. As in example #3 above, an RToken's collaterals may have completely different `{target}` units, but be valued by the same `{UoA}`.

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

This is the form of the basket that recipients and redeemer will care most about. Issuance and redemption quantities are given by the collateral basket times the current `rTok/BU` exchange rate.

While an issuance is pending in the mempool, the quantities of tokens that will be ingested when the transaction is mined may decrease slightly as the collateral becomes worth more. If furnace melting happens in that time, however, this can increase the quantity of collateral tokens in the basket and cause the issuance to fail.

On the other hand, while a redemption is pending in the mempool, the quantities of collateral tokens the redeemer will receive steadily decreases. If a furnace melting happens in that time the quantities will be increased, causing the redeemer to get more than they expected.

## System States

- `tradingPaused`: all interactions disabled EXCEPT ERC20 functions + RToken.issue + RToken.redeem + StRSR.stake + StRSR.payoutRewards
- `issuancePaused`: all interactions enabled EXCEPT RToken.issue
- `frozen`: all interactions disabled EXCEPT ERC20 functions + StRSR.stake + StRSR.payoutRewards

Freezing can occur over two timescales: short freezing + long freezing.

Non-owner roles:

- `PAUSER`
- `SHORT_FREEZER`
- `LONG_FREEZER`

Design intentions:

- The PAUSER role should be assigned to an address that is able to act quickly in response to off-chain events, such as a Chainlink feed failing. It is acceptable for there to be false positives, since redemption remains enabled.
- The SHORT_FREEZER role should be assigned to an address that might reasonably be expected to be the first to detect a bug in the code and can act quickly, and with some tolerance for false positives though less than in pausing. If a bug is detected, a short freeze can be triggered which will automatically expire if it is not renewed by LONG_FREEZER. The OWNER (governance) may also step in and unfreeze at any time.
- The LONG_FREEZER role should be assigned to an address that will highly optimize for no false positives. It is much longer than the short freeze. It exists so that in the case of a zero-day exploit, governance can act before the system unfreezes and resumes functioning.

## System Auctions

The Reserve Protocol makes a few different types of trades:

- from collateral to RSR or RToken, in order to distribute collateral yields. These happen often in a RevenueTrader.
- from reward tokens to RSR or RToken, in order to distribute tokens rewards from collateral. These also happen often in a RevenueTrader.
- collateral to collateral, in order to change the distribution of collateral due to a basket change. Basket changes should be rare, happening only when governance changes the basket, or when some collateral token defaults. This only happens in the BackingManager.
- RSR to collateral, in order to recollateralize the protocol from stRSR over-collateralization, after a basket change. These auctions should be even rarer, happening when there's a basket change and insufficient capital to achieve recollateralization without using the over-collateralization buffer. These auctions also happen in the BackingManager.

Each type of trade can happen two ways: either by a falling-price dutch auction (DutchTrade) or by a batch auction via Gnosis EasyAuction (GnosisTrade). More trading methods can be added in the future.

### Gnosis EasyAuction Batch Auctions (GnosisTrade)

A good explainer for how Gnosis auctions work can be found (on their github)[https://github.com/gnosis/ido-contracts].

### Dutch Auctions (DutchTrade)

The Dutch auction occurs in two phases:

Geometric/Exponential Phase (first 40% of auction): The price starts at about 1000x the best plausible price and decays down to the best plausible price following a geometric/exponential series. The price decreases by the same percentage each time. This phase is primarily defensive, and it's not expected to receive a bid; it merely protects against manipulated prices.

Linear Phase (last 60% of auction): During this phase, the price decreases linearly from the best plausible price to the worst plausible price.

The `dutchAuctionLength` can be configured to be any value. The suggested default is 30 minutes for a blockchain with a 12-second blocktime. At this ratio of blocktime to auction length, there is a 10.87% price drop per block during the geometric/exponential period and a 0.05% drop during the linear period. The duration of the auction can be adjusted, which will impact the size of the price decreases per block.

The "best plausible price" is equal to the exchange rate at the high price of the sell token and the low price of the buy token. The "worst-case price" is equal to the exchange rate at the low price of the sell token and the high price of the sell token, plus an additional discount equal to `maxTradeSlippage`.

### Collateral decimals restriction

The protocol only supports collateral tokens with up to 21 decimals, and for these cases only supports balances up to `~8e28`. Exceeding this could end up overflowing the `uint96` restrictions in GnosisTrade / EasyAuction. We expect `~70e6` whole tokens (for 21 decimals) to always be worth more than the `minTradeVolume`. Note that even when this assumption breaks, the protocol behaves gracefully and downsizes the GnosisTrade to be within the limits.

In terms of rounding, with a 21 decimals token, we lose 3 decimal places when rounding down to our 18 decimal fixed point numbers (up to 999 wei). Even if one whole token is worth 1 billion USD, `1e3` wei will only be worth `1e-9` USD in that case. This is an acceptable loss.

#### Trade violation fallback

Dutch auctions become disabled for an asset being traded if a trade clears in the geometric phase. The rationale is that a trade that clears in this range (multiples above the plausible price) only does so because either 1) the auctioned asset's price was manipulated downwards, or 2) the bidding asset was manipulated upwards, such that the protocol accepts an unfavorable trade. All subsequent trades for that particular trading pair will be forced to use the batch auctions as a result. Dutch auctions for disabled assets must be manually re-enabled by governance.

Take for example the scenario of an RToken basket change requiring a trade of 5M USDC for 5M USDT, where the `maxTradeSize` is $1M (therefore requiring at least 5 auctions). If the system's price inputs for USDC was manipulated to read a price of $0.001/USDC, settling the auction in the geometric phase at any multiple less than 1000x will yield a profit for the trader, at a cost to the RToken system. Accordingly, Dutch auctions become disabled for the subsequent trades to swap USDC to USDT.

Dutch auctions for other assets that have not cleared in the geometric zone will remain enabled.

#### Sample price curve

This price curve is for two assets with 1% oracleError, and with a 1% maxTradeSlippage, during a 30-minute auction. The token has 6 decimals and the "even price" occurs at 100,000,000. The phase changes between different portions of the auction are shown with `============` dividers.

```
BigNumber { value: "102020210210" }
BigNumber { value: "82140223099" }
BigNumber { value: "66134114376" }
BigNumber { value: "53247007608" }
BigNumber { value: "42871124018" }
BigNumber { value: "34517153077" }
BigNumber { value: "27791029333" }
BigNumber { value: "22375579749" }
BigNumber { value: "18015402132" }
BigNumber { value: "14504862785" }
BigNumber { value: "11678398454" }
BigNumber { value: "9402708076" }
BigNumber { value: "7570466062" }
BigNumber { value: "6095260636" }
BigNumber { value: "4907518495" }
BigNumber { value: "3951227569" }
BigNumber { value: "3181278625" }
BigNumber { value: "2561364414" }
BigNumber { value: "2062248686" }
BigNumber { value: "1660392258" }
BigNumber { value: "1336842869" }
BigNumber { value: "1076341357" }
BigNumber { value: "866602010" }
BigNumber { value: "697733148" }
BigNumber { value: "561770617" }
BigNumber { value: "452302636" }
BigNumber { value: "364165486" }
BigNumber { value: "293203025" }
BigNumber { value: "236068538" }
BigNumber { value: "190067462" }
BigNumber { value: "153030304" }
============
BigNumber { value: "151670034" }
BigNumber { value: "150309765" }
BigNumber { value: "148949495" }
BigNumber { value: "147589226" }
BigNumber { value: "146228957" }
BigNumber { value: "144868687" }
BigNumber { value: "143508418" }
BigNumber { value: "142148149" }
BigNumber { value: "140787879" }
BigNumber { value: "139427610" }
BigNumber { value: "138067341" }
BigNumber { value: "136707071" }
BigNumber { value: "135346802" }
BigNumber { value: "133986532" }
BigNumber { value: "132626263" }
BigNumber { value: "131265994" }
BigNumber { value: "129905724" }
BigNumber { value: "128545455" }
BigNumber { value: "127185186" }
BigNumber { value: "125824916" }
BigNumber { value: "124464647" }
BigNumber { value: "123104378" }
BigNumber { value: "121744108" }
BigNumber { value: "120383839" }
BigNumber { value: "119023570" }
BigNumber { value: "117663300" }
BigNumber { value: "116303031" }
BigNumber { value: "114942761" }
BigNumber { value: "113582492" }
BigNumber { value: "112222223" }
BigNumber { value: "110861953" }
BigNumber { value: "109501684" }
BigNumber { value: "108141415" }
BigNumber { value: "106781145" }
BigNumber { value: "105420876" }
BigNumber { value: "104060607" }
BigNumber { value: "102700337" }
============
BigNumber { value: "101986999" }
BigNumber { value: "101920591" }
BigNumber { value: "101854183" }
BigNumber { value: "101787775" }
BigNumber { value: "101721367" }
BigNumber { value: "101654959" }
BigNumber { value: "101588551" }
BigNumber { value: "101522143" }
BigNumber { value: "101455735" }
BigNumber { value: "101389327" }
BigNumber { value: "101322919" }
BigNumber { value: "101256511" }
BigNumber { value: "101190103" }
BigNumber { value: "101123695" }
BigNumber { value: "101057287" }
BigNumber { value: "100990879" }
BigNumber { value: "100924471" }
BigNumber { value: "100858063" }
BigNumber { value: "100791655" }
BigNumber { value: "100725247" }
BigNumber { value: "100658839" }
BigNumber { value: "100592431" }
BigNumber { value: "100526023" }
BigNumber { value: "100459615" }
BigNumber { value: "100393207" }
BigNumber { value: "100326799" }
BigNumber { value: "100260391" }
BigNumber { value: "100193983" }
BigNumber { value: "100127575" }
BigNumber { value: "100061167" }
BigNumber { value: "99994759" }
BigNumber { value: "99928351" }
BigNumber { value: "99861943" }
BigNumber { value: "99795535" }
BigNumber { value: "99729127" }
BigNumber { value: "99662719" }
BigNumber { value: "99596311" }
BigNumber { value: "99529903" }
BigNumber { value: "99463496" }
BigNumber { value: "99397088" }
BigNumber { value: "99330680" }
BigNumber { value: "99264272" }
BigNumber { value: "99197864" }
BigNumber { value: "99131456" }
BigNumber { value: "99065048" }
BigNumber { value: "98998640" }
BigNumber { value: "98932232" }
BigNumber { value: "98865824" }
BigNumber { value: "98799416" }
BigNumber { value: "98733008" }
BigNumber { value: "98666600" }
BigNumber { value: "98600192" }
BigNumber { value: "98533784" }
BigNumber { value: "98467376" }
BigNumber { value: "98400968" }
BigNumber { value: "98334560" }
BigNumber { value: "98268152" }
BigNumber { value: "98201744" }
BigNumber { value: "98135336" }
BigNumber { value: "98068928" }
BigNumber { value: "98002520" }
BigNumber { value: "97936112" }
BigNumber { value: "97869704" }
BigNumber { value: "97803296" }
BigNumber { value: "97736888" }
BigNumber { value: "97670480" }
BigNumber { value: "97604072" }
BigNumber { value: "97537664" }
BigNumber { value: "97471256" }
BigNumber { value: "97404848" }
BigNumber { value: "97338440" }
BigNumber { value: "97272032" }
BigNumber { value: "97205624" }
BigNumber { value: "97139216" }
BigNumber { value: "97072808" }
============
BigNumber { value: "97039604" }
BigNumber { value: "97039604" }
BigNumber { value: "97039604" }
BigNumber { value: "97039604" }
BigNumber { value: "97039604" }
BigNumber { value: "97039604" }
BigNumber { value: "97039604" }
```
