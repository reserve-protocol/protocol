# Writing Collateral Plugins

This document describes what a developer needs to know to begin writing and contributing collateral plugins.

## Background

The core protocol depends on two plugin types:

1. _Asset / Collateral_
   `contracts/plugins/assets`
2. _Trading_ (not discussed here)
   `contracts/plugins/trading`

In our inheritance tree, Collateral is a subtype of Asset (i.e. `ICollateral is IAsset`). An Asset describes how to interact with and price an ERC20 token. An instance of the Reserve Protocol can use an ERC20 token if and only if its `AssetRegistry` contains an asset modeling that token. An Asset provides the Reserve Protocol with information about the token:

- How to get its price
- A maximum volume per trade
- How to claim token rewards, if the token offers them

A Collateral contract is a subtype of Asset (i.e. `ICollateral is IAsset`), so it does everything as Asset does. Beyond that, a Collateral plugin provides the Reserve Protocol with the information it needs to use its token as collateral -- as backing, held in the RToken's basket.

- Its ERC20 token can be used to back an RToken, not just be bought and sold
- A Collateral has a `refresh()` method that is called at the start of any significant system interaction (i.e. `@custom:interaction`).
- A Collateral has a `status()` view that returns a `CollateralStatus` value, which is one of `SOUND`, `IFFY`, or `DISABLED`.
- A Collateral provides 3 exchange rates in addition to the `{UoA/tok}` prices provided by an Asset: `{ref/tok}`, `{target/ref}`, and `{UoA/target}`. A large part of designing a collateral plugin is deciding how these exchange rates should be computed. This is discussed below, under [Accounting Units and Exchange Rates](#Accounting_Units_and_Exchange_Rates). If this notation for units is entirely new to you, first read [our explanation of this unit notation](solidity-style.md#Units-in-comments).

The IAsset and ICollateral interfaces, from `IAsset.sol`, are as follows:

```solidity
/**
 * @title IRewardable
 * @notice A simple interface mixin to support claiming of rewards.
 */
interface IRewardable {
  /// Emitted whenever a reward token balance is claimed
  event RewardsClaimed(IERC20 indexed erc20, uint256 indexed amount);

  /// Claim rewards earned by holding a balance of the ERC20 token
  /// Must emit `RewardsClaimed` for each token rewards are claimed for
  /// @dev delegatecall: there be dragons here!
  /// @custom:interaction
  function claimRewards() external;
}

/**
 * @title IAsset
 * @notice Supertype. Any token that interacts with our system must be wrapped in an asset,
 * whether it is used as RToken backing or not. Any token that can report a price in the UoA
 * is eligible to be an asset.
 */
interface IAsset {
  /// Can return 0, can revert
  /// Shortcut for price(false)
  /// @return {UoA/tok} The current price(), without considering fallback prices
  function strictPrice() external view returns (uint192);

  /// Can return 0
  /// Should not revert if `allowFallback` is true. Can revert if false.
  /// @param allowFallback Whether to try the fallback price in case precise price reverts
  /// @return isFallback If the price is a failover price
  /// @return {UoA/tok} The current price(), or if it's reverting, a fallback price
  function price(bool allowFallback) external view returns (bool isFallback, uint192);

  /// @return {tok} The balance of the ERC20 in whole tokens
  function bal(address account) external view returns (uint192);

  /// @return The ERC20 contract of the token with decimals() available
  function erc20() external view returns (IERC20Metadata);

  /// @return The number of decimals in the ERC20; just for gas optimization
  function erc20Decimals() external view returns (uint8);

  /// @return If the asset is an instance of ICollateral or not
  function isCollateral() external view returns (bool);

  /// @param {UoA} The max trade volume, in UoA
  function maxTradeVolume() external view returns (uint192);
}

/// CollateralStatus must obey a linear ordering. That is:
/// - being DISABLED is worse than being IFFY, or SOUND
/// - being IFFY is worse than being SOUND.
enum CollateralStatus {
  SOUND,
  IFFY, // When a peg is not holding or a chainlink feed is stale
  DISABLED // When the collateral has completely defaulted
}

/**
 * @title ICollateral
 * @notice A subtype of Asset that consists of the tokens eligible to back the RToken.
 */
interface ICollateral is IAsset {
  /// Refresh exchange rates and update default status.
  /// The Reserve protocol calls this at least once per transaction, before relying on
  /// this collateral's prices or default status.
  function refresh() external;

  /// @return The canonical name of this collateral's target unit.
  function targetName() external view returns (bytes32);

  /// @return The status of this collateral asset. (Is it defaulting? Might it soon?)
  function status() external view returns (CollateralStatus);

  // ==== Exchange Rates ====

  /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
  function refPerTok() external view returns (uint192);

  /// @return {target/ref} Quantity of whole target units per whole reference unit in the peg
  function targetPerRef() external view returns (uint192);
}

```

## Accounting Units and Exchange Rates

To create a Collateral plugin, you need to select its accounting units (`{tok}`, `{ref}`, `{target}`, and `{UoA}`), and implement views of the exchange rates: `refPerTok()` and `targetPerRef()`.

Typical accounting units in this sense are things like ETH, USD, USDC -- tokens, assets, currencies; anything that can be used as a measure of value. In general, a valid accounting unit is a linear combination of any number of assets; so (1 USDC + 0.5 USDP + 0.25 TUSD) is a valid unit, as is (say) (0.5 USD + 0.5 EUR), though such units will probably only arise in particularly tricky cases. Each Collateral plugin should describe in its documentation each of its four accounting units

As a quick overview:

- The unit `{tok}` is just the concrete token being modeled.
- The protocol measures growth as the increase of the value of `{tok}` against the value of `{ref}`, and treats that growth as revenue.
- If two Collateral plugins have the same `{target}`, then when one defaults, the other one can serve as backup collateral.
- The unit `{UoA}` is a common accounting unit across all collateral in an RToken.

### Collateral unit `{tok}`

The collateral unit `{tok}` is just 1 of the ERC20 token that the Collateral plugin models. The protocol directly holds this unit of value.

This is typically a token that is interesting to hold because it allows the accumulation of ever-increasing amounts of some other more-fundamental unit, called the reference unit. It's also possible for collateral to be non-appreciating, in which case it may still make sense to hold the collateral either because it allows the claiming of rewards over time, or simply because the protocol strongly requires stability (usually, short-term).

Note that a value denoted `{tok}` is a number of "whole tokens" with 18 decimals. So even though DAI has 18 decimals and USDC has 6 decimals, $1 in either token would be 1e18 when working with `uint192` values with the unit `{tok}`. For context on our approach for handling decimal-fixed-point, see [The Fix Library](solidity-style.md#The-Fix-Library).

### Reference unit `{ref}`

The _reference unit_, `{ref}`, is the measure of value that the protocol computes revenue against. When the exchange rate `refPerTok()` rises, the protocol keeps a constant amount of `{ref}` as backing, and sells the rest of the token it holds as revenue.

There's room for flexibility and creativity in the choice of a Collateral's reference unit. The chief constraints are:

- `refPerTok() {ref}` should always be a good market rate for 1 `{tok}`
- `refPerTok()` must be nondecreasing over time, at least on some sensible model of the collateral token's economics. If that model is violated, the Collateral plugin should immediately default. (i.e, permanently set `status()` to `DISABLED`)

In many cases, the choice of reference unit is clear.

- The collateral token cUSDC (compound USDC) has a natural reference unit of USDC. cUSDC is permissionlessly redeemable in the Compound protocol for an ever-increasing amount of USDC.
- The collateral token USDT is its own natural reference unit. It's not natively redeemable for anything else on-chain, and we think of it as non-appreciating collateral. (Consider: what would it mean for USDT to "appreciate"?)

Often, the collateral token is directly redeemable for the reference unit in the token's protocol. (When this is the case, you can usually implement `refPerTok()` by looking up the redemption rate between the collateral token and its underlying token!) If you want to keep things simple, stick to "natural" collateral produced by protocols with nondecreasing exchange rates.

However, the protocol never tries to handle reference-unit tokens itself, and in fact reference-unit tokens don't even need to exist. Thus, a Collateral can have a _synthetic_ reference unit for which there exists no corresponding underlying token. For some worked-out examples, read [Synthetic Unit Examples](#Synthetic_Unit_Example) below.

### Target unit `{target}`

The _target unit_, `{target}`, is the type of value that the Collateral is expected by users to represent over time. For instance, an RToken intended to be a USD stablecoin probably has a basket made of Collateral for which `{target} = USD`. When the protocol must reconfigure the basket, it will replace defaulting "prime" Collateral with other "backup" Collateral if and only if they have the same target unit.

The target unit has to do with a concept called the Target Basket, and ultimately comes down to the reasons why this collateral might be chosen as backing in the first place. For instance, if you create an RToken in Register, the deployer selects a linear combination of target units such as:

- 1 USD
- 0.5 USD + 0.55 EURO
- 0.5 USD + 0.35 EURO + 0.00001 BTC

These Target Baskets have been selected to start with a market price of about \$1, assuming a slightly weak EURO and \$20k BTC. Over time, these RTokens would each have very different overall price trajectories.

(Note: the Target Basket never manifests in the code directly. In the code, we have a slightly more specific concept called the Prime Basket. But the Target Basket is a coherent concept for someone thinking about the UX of an RToken. You can think of it like a simplified view of the Prime Basket.)

The target unit and reference unit must be even more tightly connected than the reference unit and collateral unit. The chief constraints on `{target}` are:

- `targetPerRef() {target}` should always be a reasonable market rate for 1 `{ref}`, ignoring short-term price fluxuations.
- `targetPerRef()` must be a _constant_.

Moreover, `{target}` should be the simplest and most common unit that can satisfy those constraints. A major purpose of the Reserve protocol is to automatically move funds stored in a defaulting token into backup positions. Collateral A can have Collateral B as a backup token if and only if they have the same target unit.

Given those desired properties, after you've selected a collateral unit and reference unit, it's typically simple to choose a sensible target unit. For USDC the target unit would be USD; for EURT it would be the EURO; for WBTC it would be BTC.

### Unit of Account `{UoA}`

The Unit of Account `{UoA}` for a collateral plugin is simply a measure of value in which asset prices can be commonly denominated and compared. In principle, it's totally arbitrary, but all collateral plugins registered with an RToken must have the same unit of account. As of the current writing (October 2022), given the price information currently available on-chain, just use `USD` for the Unit of Account.

Note, this doesn't disqualify collateral with USD as its target unit! It's fine for the target unit to be the unit of account. This doesn't disqualify collateral with a non-USD target unit either! It's fine for the target unit to be different from the unit of account. These two concepts are totally orthogonal.

### Representing Fractional Values

Wherever contract variables have these units, it's understood that even though they're handled as `uint`s, they represent fractional values with 18 decimals. In particular, a `{tok}` value is a number of "whole tokens" with 18 decimals. So even though DAI has 18 decimals and USDC has 6 decimals, $1 in either token would be 1e18 when working in units of `{tok}`.

For more about our approach for handling decimal-fixed-point, see our [docs on the Fix Library](solidity-style.md#The-Fix-Library).

## Synthetic Units

Some collateral positions require a synthetic reference unit. This can be tricky to reason through, so here we'll provide a few examples.

### Using Uniswap V2 LP Tokens

Consider the Uniswap V2 LP token, **UNI-V2**, for the USDC/USDT pair. (The following discussion assumes that you, reader, are familiar with the basic design of Uniswap V2. Their [documentation][univ2] is an excellent refresher.) Such a Collateral position might aim to earn revenue from liquidity fees, while maintaining a fully redeemable position in the two underlying fiatcoins.

[univ2]: https://docs.uniswap.org/protocol/V2/concepts/protocol-overview/how-uniswap-works

A position's "natural" reference unit is whatever it's directly redeemable for. However, a Uniswap v2 LP token is not redeemable for any fixed, concrete unit. Rather, it's redeemable _pro rata_ for a share of the tokens in the liquidity pool, which can constantly change their proportion as trading occurs.

To demonstrate this difficulty, imagine we choose "1 USD" for the reference unit. We presume in this design that 1 USDC and 1 USDT are continuously redeemable for 1 USD each -- the Collateral can watch that assumption on price feeds and default if it fails, this is fine -- and we implement `refPerTok()` by computing the present redemption value of an LP token in USD. _This won't work_, because the redemption value of the LP token increases any time trading moves the pool's proportion of USDC to USDT tokens briefly away from the 1:1 point, and then decreases as trading brings the pool's proportion back to the 1:1 point. The protocol requires that `refPerTok()` never decreases, so this will cause immediate defaults.

Instead, you might imagine that we choose "1 USDC + 1 USDT" as the reference unit. We compute `refPerTok()` at any moment by observing that we can redeem the `L` LP tokens in existence for `x` USDC and `y` USDT, and returning `min(x, y)/L`. _This also won't work_, because now `refPerTok()` will decrease any time the pool's proportion moves away from the 1:1 point, and it will increase whenever the proportion moves back.

To make this Collateral position actually work, we have to account revenues against the pool's invariant. Assuming that there's a supply of `L` LP tokens for a pool with `x` USDC and `y` USDT, the strange-looking reference unit `sqrt(USDC * USDT)`, with corresponding `refPerTok() = sqrt(x * y)/L`, works exactly as desired.

Without walking through the algebra, we can reason our way heuristically towards this design. The exchange rate `refPerTok()` should be a value that only ever increases. In UNI V2, that means it must not change when LP tokens are deposited or withdrawn; and it must not change due to trading, except insofar as it increases due to the protocol's fees. Deposit and withdrawal change all of `x`, `y`, and `L`, but in a lawful way: `x * y / (L * L)` is invariant even when the LP supply is changed due deposits or withdrawals. If there were zero fees, the same expression would be invariant during trading; with fees, `x * y` only increases, and so `x * y / (L * L)` only increases. However, this expression has bizarre units. However, this expression cannot possibly be a rate "per LP token", it's a rate per square of the LP token. Taking the square root gives us a rate per token of `sqrt(x * y) / L`.

[^comment]: tbh it's be a _good idea_ to walk through the algebra here, I'm just ... very busy right now!

After this choice after reference unit, we have two reasonable choices for target units. The simplest choice is to assert that the target unit is essentially unique to this particular instance of UNI v2 -- named by some horrible unique string like `UNIV2SQRTUSDTCUSDT` -- and that its redemption position cannot be traded, for certain, for any other backup position, so it cannot be backed up by a sensible basket.

This would be sensible for many UNI v2 pools, but someone holding value in a two-sided USD-fiatcoin pool probably intends to represent a USD position with those holdings, and so it'd be better for the Collateral plugin to have a target of USD. This is coherent so long as the Collateral plugin is setup to default under any of the following conditions:

- According to a trusted oracle, USDC is far from \$1 for some time
- According a trusted oracle, USDT is far from \$1 for some time
- The UNI v2 pool is far from the 1:1 point for some time

And even then, it would be somewhat dangerous for an RToken designer to use this LP token as a _backup_ Collateral position -- because whenever the pool's proportion is away from 1:1 at all, it'll take more than \$1 of collateral to buy an LP position that can reliably convert to \$1 later.

### Demurrage Collateral

If the collateral token does not have a reference unit it is nondecreasing against except for itself, a revenue stream can be created by composing a synthetic reference unit that refers to a falling quantity of the collateral token. This causes the reference unit to become inflationary with respect to the collateral unit, resulting in a monotonically increasing `refPerTok()` and allowing the protocol to recognize revenue.

Consider `wstETH`, the wrapped version of Lido's `stETH` token. While the `wstETH/stETH` exchange rate should generally increase, there may be times when Lido node operators go offline and the exchange rate temporarily falls. This is very different than a case like `cWETH`, where even a small decrease in `refPerTok()` would be sufficient to justify defaulting the collateral on the grounds that the protocol itself is failing. _Large_ decreases may be sufficient to justify default, but small decreases may be acceptable/expected.

Plan: To ensure `refPerTok()` is nondecreasing, the reference unit is defined as a falling quantity of the collateral unit. As the reference unit "gets smaller", `refPerTok()` increases. This is viewed by the protocol as appreciation, allowing it to decrease how much `wstETH` (or more generally: collateral token) is required per basket unit.

**Reference Unit**

The equation below describes the relationship between the collateral unit and an inflationary reference unit. Over time there come to be more reference units per collateral token, allowing the protocol to identify revenue.

```
refPerTok(): (1 + demurrage_rate_per_second) ^ t
    where t is seconds since 01/01/2020 00:00:00 GMT+0000
```

The timestamp of 01/01/2020 00:00:00 GMT+0000 is chosen arbitrarily. It's not important what this value is, generally, but it's going to wind up being important that this anchor timestamp is the same _for all_ demurrage collateral, so we suggest just sticking with the provided timestamp. In unix time this is `1640995200`.

(Note: In practice this equation will also have to be adjusted to account for the limited computation available on Ethereum. While the equation is expressed in terms of seconds, a larger granularity is likely necessary, such as hours or days. Exponentiation is expensive!)

**Target Unit**

A [constraint on the target unit](#target-unit-target) is that it should have a roughly constant exchange rate to the reference unit, modulo short-term price movements. In order to maintain this property, the target unit should be set to inflate at the same rate as the reference unit. This yields a trivial `targetPerRef()`.

```
targetPerRef(): 1
```

The target unit must be named in a way that distinguishes it from the non-demurrage version of itself. We suggest the following naming scheme:

`DMR{annual_demurrage_in_basis_points}{token_symbol}` or `DMR100wstETH` in this example.

The `DMR` prefix is short for demurrage; the `annual_demurrage_in_basis_points` is a number such as 100 for 1% annually; the `token_symbol` is the symbol the collateral.

Collateral can only be automatically substituted in the basket with collateral that share the same target unit. This unfortunately means that a standard WETH collateral would not be able to be in the same class as our demurrage wstETH collateral, unless the WETH collateral were also demurrage-based, and at the same rate.

### Revenue Hiding

An alternative to demurrage is to hide revenue from the protocol via a discounted `refPerTok()` function. `refPerTok()` should return X% less than the largest _actual_ refPerTok exchange rate that has been observed in the underlying Defi protocol. When the actual observed rate falls below this value, the collateral should be marked defaulted via the `refresh()` function.

The side-effect of this approach is that the RToken's price on markets becomes more variable. If the RToken's price need be predictable/precise, then demurrage is the superior approach. If the token's natural appreciation is too unpredictable to apply a constant per-unit-time management fee to, then revenue-hiding may be a better fit.

## Important Properties for Collateral Plugins

### Reuse of Collateral Plugins

Collateral plugins should be safe to reuse by many different Reserve Protocol instances. So:

- Collateral plugins should neither require governance nor give special permissions to any particular accounts.
- Collateral plugins should not pull information from an RToken instance that they expect to use them directly. (There is already an RToken Asset that uses price information from the protocol directly; but it must not be extended for use as Collateral in its own basket!)

### Token balances must be transferrable

Collateral tokens must be tokens in the formal sense. That is: they must provide balances to holders, and these balances must be transferrable.

Some tokens may not be transferrable. Worse still, some positions in defi are not tokenized to begin with: take for example DSR-locked DAI or Convex's boosted staking positions. In these cases tokenization can be achieved by wrapping the position. In this kind of setup the wrapping contract issues tokens that correspond to pro-rata shares of the overall defi position, which it maintains under the hood in relation with the defi protocol.

Here are some examples of what this looks like in Convex's case [here](https://github.com/convex-eth/platform/tree/main/contracts/contracts/wrappers).

### Token balances cannot be rebasing

Some defi protocols yield returns by increasing the token balances of users, called _rebasing_. For instance, ATokens from Aave and stETH from Lido are both rebasing tokens. While people often like this, smart contracts certainly do not.

The Reserve Protocol cannot directly hold rebasing tokens. However, the protocol can indirectly hold a rebasing token, if it's wrapped by another token that does not itself rebase, but instead appreciates only through exchange-rate increases. Any rebasing token can be wrapped to be turned into an appreciating exchange-rate token, and vice versa.

To use a rebasing token as collateral backing, the rebasing ERC20 needs to be replaced with an ERC20 that is non-rebasing. This is _not_ a change to the collateral plugin contract itself. Instead, the collateral plugin designer needs to provide a wrapping ERC20 contract that RToken issuers or redeemers will have to deposit into or withdraw from. We expect to automate these transformations as zaps in the future, but at the time of this writing everything is still manual.

For an example of a token wrapper that performs this transformation, see [StaticATokenLM.sol](../contracts/plugins/aave/StaticATokenLM.sol). This is a standard wrapper to wrap Aave ATokens into StaticATokens. A thinned-down version of this contract makes a good starting point for developing other ERC20 wrappers -- but if the token is well-integrated in defi, a wrapping contract probably already exists.

The same wrapper approach is easily used to tokenize positions in protocols that do not produce tokenized or transferrable positions.

### `refresh()` should never revert

Because it’s called at the beginning of many transactions, `refresh()` should never revert. If `refresh()` encounters a critical error, it should change the Collateral contract’s state so that `status()` becomes `DISABLED`.

### `strictPrice()`, `price(bool)`, and `status()`

The Reserve protocol is designed to sensibly handle tokens under various error conditions. To enable this, Asset contracts that rely on external price feeds of whatever kind must provide a sensible "fallback" price mechanism. This fallback price should be selectively exposed. When `price(true)` is called, this is an indication to the plugin that a fallback price can be returned if the primary price is unavailable.

`strictPrice()` should revert if any of the price information it relies upon to give a high-quality price is unavailable; `price(false)` should behave essentially the same way. In a situation where `strictPrice()` or `price(false)` would revert, `price(true)` should instead return `(true, p)`, where `p` is some reasonable fallback price computed without relying on the failing price feed.

If a Collateral's `refresh()` method is called during conditions when only fallback prices are available, its `status()` should become either `IFFY` or `DISABLED`.

### The `IFFY` status should be temporary.

If a contract's `status()` has been `IFFY` on every call to `refresh()` for some (configured, finite) amount of time, then the status() should become `DISABLED`.

Unless there's a good reason for a specific collateral to use a different mechanism, that maximum `IFFY` duration should be a parameter given in the Collateral plugin's constructor.

### Collateral must default if `refPerTok()` falls.

Notice that `refresh()` is the only non-view method on the ICollateral interface, so it's the only place that can deal with a state change like this. However, `refresh()` is carefully called by any flow through the RToken protocol that requires good prices or sound collateral. So, we need just the following quite specific property:

If `refresh()` is called twice, and `refPerTok()` just after the second call is lower than `refPerTok()` just after the first call, then `status()` must change to `CollateralStatus.DISABLED` immediately. This is true for any collateral plugin. For some collateral plugins it will be obvious that `refPerTok()` cannot decrease, in which case no checks are required.

### Defaulted Collateral must stay defaulted.

If `status()` ever returns `CollateralStatus.DISABLED`, then it must always return `CollateralStatus.DISABLED` in the future.

### Token rewards should be claimable via delegatecall.

Protocol contracts that hold an asset for any significant amount of time are all able to call `claimRewards()` via delegatecall. The plugin contract should include whatever logic is necessary to claim rewards from all relevant defi protocols. These rewards are often emissions from other protocols, but may also be something like trading fees in the case of UNIV3 collateral. To take advantage of this:

- `claimRewards()` should expected to be executed via delegatecall. It must claim all rewards that may be earned by holding the asset ERC20.
- The `RewardsClaimed` event should be emitted for each claim.

### Smaller Constraints

For a Collateral contract, `isCollateral()` always returns `true`.

The values returned by the following view methods should never change:

- `targetName()`
- `erc20()`
- `erc20Deciamls()`

## Function-by-function walkthrough

### refresh()

`function refresh() external`

Because `refresh()` is relied upon by so much of the protocol, it is important that it only reverts due to out-of-gas errors. So, wrap any risky external calls that might throw in a try-catch block like this one:

```
try externalLibrary.call() returns (bool) {
    markStatus(...)
    ...
} catch (bytes memory errData) {
    if (errData.length == 0) revert(); // out-of-gas error
    ...
    markStatus(...)
}
```

See also: [Catching Empty Data](solidity-style.md#Catching-Empty-Data).

If `refresh()` changes the current CollateralStatus, it must emit a `CollateralStatusChanged` event.

You may include additional mutators on a Collateral plugin implementation, but `refresh()` is the only mutator that the Reserve protocol will call.

It's common for a Collateral plugin to reply on economic or technical assumptions that might go wrong -- a fiatcoin can lose its peg, a lending protocol might become undercollateralized, a complex protocol may go wrong if a bug is found and exploited. When a plugin has such assumptions, `refresh()` is responsible for checking that its assumptions still hold, and changing the CollateralStatus to `IFFY` or `DISABLED` when it cannot ascertain that its assumptions hold.

`status()` should trigger `DISABLED` when `refresh()` can tell that its assumptions are definitely being violated, and `status()` should trigger `IFFY` if it cannot tell that its assumptions _aren't_ being violated.

#### Types of Default

Broadly speaking there are two ways a collateral can default:

1.  Fast: `refresh()` detects a clear problem with its defi protocol, and triggers in an immediate default. For instance, anytime the `refPerTok()` exchange rate falls between calls to `refresh()`, the collateral should immediately default.
2.  Slow: `refresh()` detects a error condition that will _probably_ recover, but which should cause a default eventually. For instance, if the Collateral relies on USDT, and our price feed says that USDT trades at less than \$0.95 for (say) 24 hours, the Collateral should default. If a needed price feed is out-of-date or reverting for a similar period, the Collateral should default.

    In either of these cases, the collateral should first become `IFFY` and only move to `DISABLED` after the problem becomes sustained. In general, any pathway for default that cannot be assessed immediately should go through this delayed flow.

### status()

`function status() external view returns (CollateralStatus)`

After `refresh()` has been called, the protocol expects `status()` to return an up-to-date `CollateralStatus`

```
enum CollateralStatus {
    SOUND,
    IFFY, // When a peg is not holding or a chainlink feed is stale
    DISABLED // When the collateral has completely defaulted
}
```

#### Reasons to default

After a call to `refresh()`, it is expected the collateral is either `IFFY` or `DISABLED` if any of the following calls might revert:

- `strictPrice()`
- `price(false)`
- `refPerTok()`
- `targetPerRef()`

The collateral should also be immediately set to `DISABLED` if `refPerTok()` has fallen.

A Collateral plugin may become `DISABLED` for other reasons as well. For instance, if an ERC20 represents a bridged asset, the Collateral should monitor the exchange rate to the canonical asset for deviations. A sustained period of deviation, or simply stale oracle data, should result in the collateral becoming `DISABLED`.

As long as it observes such a price irregularity, the Collateral's `status()` should return `IFFY`. It is up to the collateral how long the `IFFY` period lasts before the collateral becomes `DISABLED`, but it is critical that this period is finite and relatively short; this duration should probably be an argument in the plugin's constructor.

Lastly, once a collateral becomes `DISABLED`, it must remain `DISABLED`.

### strictPrice() `{UoA/tok}`

Should revert if pricing data is unavailable.

Should act identically to `price(false)`.

Should be gas-efficient.

### price(bool) `{UoA/tok}`

Can revert if `False`. Should not revert if `True`.

Can use fallback pricing data if `True`.

Should be gas-efficient.

### refPerTok() `{ref/tok}`

Should never revert.

Should never decrease. The plugin should monitor this value for decrease in its `refresh()` function if necessary.

Should be gas-efficient.

### targetPerRef() `{target/ref}`

Should never revert. Must return a constant value.

Should be gas-efficient.

### isCollateral()

Should return `True`.

### targetName()

The target name is just a bytes32 serialization of the target unit string. Here are some common values below:

- USD: `0x5553440000000000000000000000000000000000000000000000000000000000`
- EURO: `0x4555524f00000000000000000000000000000000000000000000000000000000`
- ETH: `0x4554480000000000000000000000000000000000000000000000000000000000`
- BTC: `0x4254430000000000000000000000000000000000000000000000000000000000`

For a collateral plugin that uses a novel target unit, get the targetName with `ethers.utils.formatBytes32String(unitName)`.

If implementing a demurrage-based collateral plugin, make sure your targetName differs from the examples above and follows the pattern laid out in [Demurrage Collateral](#demurrage-collateral).

## Practical Advice from Previous Work

In our own collateral plugin development, we found it useful to implement Collateral plugins by extended a common, abstract contract. Consider subclassing [AbstractCollateral.sol](../contracts/plugins/assets/AbstractCollateral.sol) and its parent class [Asset.sol](../contracts/plugins/assets/Asset.sol) for your own Collateral plugin.

If you're quite stuck, you might also find it useful to read through our other Collateral plugins as models, found in our repository in `/contracts/plugins/assets`.
