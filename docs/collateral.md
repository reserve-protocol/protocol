# Collateral Plugins

This document describes what a developer needs to know to begin writing and contributing collateral plugins.

## Background

The core protocol depends on two plugin types:

1. _Asset / Collateral_
   `contracts/plugins/assets`
2. _Trading_ (not discussed here)
   `contracts/plugins/trading`

In our inheritance tree, Collateral is a subtype of Asset (i.e. `ICollateral is IAsset`). An Asset describes how to treat and price an ERC20 token, allowing the protocol to buy and sell the token. An instance of the Reserve Protocol can use an ERC20 token iff its `AssetRegistry` contains an asset modeling that token. An Asset provides the Reserve Protocol with:

- How to get its (USD) price
- A maximum volume per trade
- A `refresh()` mutator function

A Collateral contract is a subtype of Asset (i.e. `ICollateral is IAsset`), so it does everything as Asset does. Beyond that, a Collateral plugin provides the Reserve Protocol with the information it needs to use its token as collateral -- as backing, held in the RToken's basket. Mainly this involves the addition of 2 exchange rates and a `Collateral Status`.

For a collateral:

- Its ERC20 token can be used to back an RToken, not just be bought and sold
- A Collateral has a `status()` view that returns a `CollateralStatus` value, which is one of `SOUND`, `IFFY`, or `DISABLED`.
- A Collateral provides 2 exchange rates in addition to the `{UoA/tok}` price provided by an Asset: `{ref/tok}` and `{target/ref}` (to understand this notation, see: [here](solidity-style.md#Units-in-comments). A large part of designing a collateral plugin is deciding how these exchange rates should be computed. This is discussed further below, under [Accounting Units and Exchange Rates](#Accounting_Units_and_Exchange_Rates).

The IAsset and ICollateral interfaces, from `IAsset.sol`, are as follows:

```solidity
/**
 * @title IAsset
 * @notice Supertype. Any token that interacts with our system must be wrapped in an asset,
 * whether it is used as RToken backing or not. Any token that can report a price in the UoA
 * is eligible to be an asset.
 */
interface IAsset is IRewardable {
  /// Refresh saved price
  /// The Reserve protocol calls this at least once per transaction, before relying on
  /// the Asset's other functions.
  /// @dev Called immediately after deployment, before use
  function refresh() external;

  /// Should not revert
  /// low should be nonzero if the asset could be worth selling
  /// @return low {UoA/tok} The lower end of the price estimate
  /// @return high {UoA/tok} The upper end of the price estimate
  function price() external view returns (uint192 low, uint192 high);

  /// @return {tok} The balance of the ERC20 in whole tokens
  function bal(address account) external view returns (uint192);

  /// @return The ERC20 contract of the token with decimals() available
  function erc20() external view returns (IERC20Metadata);

  /// @return The number of decimals in the ERC20; just for gas optimization
  function erc20Decimals() external view returns (uint8);

  /// @return If the asset is an instance of ICollateral or not
  function isCollateral() external view returns (bool);

  /// @return {UoA} The max trade volume, in UoA
  function maxTradeVolume() external view returns (uint192);

  /// @return {s} The timestamp of the last refresh() that saved prices
  function lastSave() external view returns (uint48);
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
  /// Emitted whenever the collateral status is changed
  /// @param newStatus The old CollateralStatus
  /// @param newStatus The updated CollateralStatus
  event CollateralStatusChanged(
    CollateralStatus indexed oldStatus,
    CollateralStatus indexed newStatus
  );

  /// @dev refresh()
  /// Refresh exchange rates and update default status.
  /// VERY IMPORTANT: In any valid implementation, status() MUST become DISABLED in refresh() if
  /// refPerTok() has ever decreased since last call.

  /// @return The canonical name of this collateral's target unit.
  function targetName() external view returns (bytes32);

  /// @return The status of this collateral asset. (Is it defaulting? Might it soon?)
  function status() external view returns (CollateralStatus);

  // ==== Exchange Rates ====

  /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
  function refPerTok() external view returns (uint192);

  /// @return {target/ref} Quantity of whole target units per whole reference unit in the peg
  function targetPerRef() external view returns (uint192);

  /// @return {target/ref} The peg price of the token during the last update
  function savedPegPrice() external view returns (uint192);
}

```

## Types of Default

Broadly speaking there are two ways a collateral can default:

1.  Fast: `refresh()` detects a clear problem with its defi protocol, and triggers in an immediate default. For instance, anytime the `refPerTok()` exchange rate falls between calls to `refresh()`, the collateral should immediately default.
2.  Slow: `refresh()` detects an error condition that will _probably_ recover, but which should cause a default eventually. For instance, if the Collateral relies on USDT, and our price feed says that USDT trades at less than \$0.95 for (say) 24 hours, the Collateral should default. If a needed price feed is out-of-date or reverting for a similar period, the Collateral should default.

    In either of these cases, the collateral should first become `IFFY` and only move to `DISABLED` after the problem becomes sustained. In general, any pathway for default that cannot be assessed immediately should go through this delayed flow.

## Security: Callbacks

The protocol specifically does not allow the use of any assets that have a callback mechanism, such as ERC777 or native ETH. In order to support these assets, they must be wrapped in an ERC20 contract that does not have a callback mechanism. This is a security consideration to prevent reentrancy attacks. This recommendation extends to LP tokens that contain assets with callback mechanisms (Such as Curve raw ETH pools - CRV/ETH for example) as well as tokens/LPs that involve WETH with unwrapping built-in.

## Accounting Units and Exchange Rates

To create a Collateral plugin, you need to select its accounting units (`{tok}`, `{ref}`, and `{target}`), and implement views of the exchange rates: `refPerTok()` and `targetPerRef()`. Wherever `{UoA}` is used, you can assume this represents USD, the modern-day typical unit of account.

Typical accounting units in this sense are things like ETH, USD, USDC -- tokens, assets, currencies; anything that can be used as a measure of value. In general, a valid accounting unit is a linear combination of any number of assets; so (1 USDC + 0.5 USDP + 0.25 TUSD) is a valid unit, as is (say) (0.5 USD + 0.5 EUR), though such units will probably only arise in particularly tricky cases. Each Collateral plugin should describe in its documentation each of its three accounting units.

As a quick overview:

- The unit `{tok}` is just the concrete token being modeled. If a wrapper needs to be involved, it is the wrapper.
- The protocol measures growth as the increase of the value of `{tok}` against the value of `{ref}`, and treats that growth as revenue.
- If two Collateral plugins have the same `{target}`, then when one defaults, the other one can serve as backup collateral.
- The unit `{UoA}` is a common accounting unit across all assets, and always means USD (for now).

### Collateral unit `{tok}`

The collateral unit `{tok}` is just the ERC20 token that the Collateral plugin models, or its wrapper, if a wrapper is involved. The protocol directly holds this unit of value.

This is typically a token that is interesting to hold because it allows the accumulation of ever-increasing amounts of some other more-fundamental unit, called the reference unit. It's also possible for collateral to be non-appreciating, in which case it may still make sense to hold the collateral either because it allows the claiming of rewards over time, or simply because the protocol strongly requires stability (usually, short-term).

Note that a value denoted `{tok}` is a number of "whole tokens" with 18 decimals. Even though DAI has 18 decimals and USDC has 6 decimals, $1 in either token would be 1e18 when working with `uint192` representations with the unit `{tok}`. For context on our approach for handling decimal-fixed-point, see [The Fix Library](solidity-style.md#The-Fix-Library). In-short, `uint192` is a special-cased uint size that always represents fractional values with 18 decimals.

### Reference unit `{ref}`

The _reference unit_, `{ref}`, is the measure of value that the protocol computes revenue against. When the exchange rate `refPerTok()` rises, the protocol keeps a constant amount of `{ref}` as backing, and considers any surplus balance of the token revenue.

There's room for flexibility and creativity in the choice of a Collateral's reference unit. The chief constraints is that `refPerTok()` must be nondecreasing over time, and as soon as this fails to be the case the `CollateralStatus` should become permanently `DISABLED`.

In many cases, the choice of reference unit is clear. For example:

- The collateral token cUSDC (compound USDC) has a natural reference unit of USDC. cUSDC is permissionlessly redeemable in the Compound protocol for an ever-increasing amount of USDC.
- The collateral token USDT is its own natural reference unit. It's not natively redeemable for anything else on-chain, and we think of it as non-appreciating collateral. The reference unit is not USD, because the USDT/USD exchange rate often has small fluctuations in both direction which would otherwise cause `refPerTok()` to decrease.

Often, the collateral token is directly redeemable for the reference unit in the token's protocol. (When this is the case, you can usually implement `refPerTok()` by looking up the redemption rate between the collateral token and its underlying token!).

However, the protocol never tries to handle reference-unit tokens itself, and in fact the reference-unit doesn't even need to necessarily exist, it can simply be a measure. For example, AMM LP tokens would use their invariant measure as the reference unit, and their exchange between the LP token and the invariant measure would be the `refPerTok()` exchange rate (i.e. get_virtual_price() in Curve).

### Target unit `{target}`

The _target unit_, `{target}`, is the type of value that the Collateral is expected by users to match over time. For instance, an RToken intended to be a USD stablecoin must necessarily have a basket of Collateral for which `{target} = USD`. When the protocol must reconfigure the basket, it will replace defaulting Collateral with other backup Collateral that share `USD` as their target unit.

The target unit and reference unit must be even more tightly connected than the reference unit and collateral unit. The chief constraints on `{target}` are:

- `targetPerRef()` must be _constant_
- `targetPerRef()` should not diverge too much from the actual measured exchange rate on secondary markets. Divergence for periods of time is acceptable, but during these times the collateral should be marked `IFFY`. If the divergence is sustained long enough, the collateral should be permanently marked `DISABLED`.

For USDC the target unit would be USD; for EURT it would be the EUR; for WBTC it would be BTC.

### Unit of Account `{UoA}`

`{UoA} = USD`

The Unit of Account `{UoA}` for a collateral plugin is simply a measure of value in which asset prices can be commonly denominated and compared. In principle it's totally arbitrary, but all collateral plugins registered with an RToken must have the same unit of account. As of the current writing (September 2023), USD is the dominant common measure. We prefer to use `{UoA}` instead of USD in our code, because it's possible that in the future the dominant unit of account may change.

Note, this doesn't disqualify collateral with USD as its target unit! It's fine for the target unit to be the unit of account. This doesn't disqualify collateral with a non-USD target unit either! It's fine for the target unit to be `BTC` and for the unit of account to be `USD`.

## Synthetic Units (Advanced)

Some collateral positions require a synthetic reference unit. The two most common cases are:

1. [Defi Protocol Invariant](#defi-protocol-invariant)
   Good for: LP tokens
2. [Revenue Hiding](#revenue-hiding)
   Good for: tokens that _almost_ have a nondecreasing exchange rate but not quite
   Update: All of our appreciating collateral now have (a small amount of) revenue hiding by default, as an additional safety measure. See [AppreciatingFiatCollateral.sol](../contracts/plugins/assets/AppreciatingFiatCollateral.sol)

These approaches can be combined. For example: [CurveStableCollateral.sol](../contracts/plugins/assets/curve/CurveStableCollateral.sol)

### Defi Protocol Invariant

Consider the Uniswap V2 LP token, **UNI-V2**, for the USDC/USDT pair. (The following discussion assumes that you, reader, are familiar with the basic design of Uniswap V2. Their [documentation][univ2] is an excellent refresher.) Such a Collateral position might aim to earn revenue from liquidity fees, while maintaining a fully redeemable position in the two underlying fiatcoins.

[univ2]: https://docs.uniswap.org/protocol/V2/concepts/protocol-overview/how-uniswap-works

A position's "natural" reference unit is whatever it's directly redeemable for. However, a Uniswap v2 LP token is not redeemable for any fixed, concrete unit. Rather, it's redeemable _pro rata_ for a share of the tokens in the liquidity pool, which can constantly change their proportion as trading occurs.

To demonstrate this difficulty, imagine we choose "1 USD" for the reference unit. We presume in this design that 1 USDC and 1 USDT are continuously redeemable for 1 USD each and we implement `refPerTok()` by computing the present redemption value of an LP token in USD. _This won't work_, because the redemption value of the LP token increases any time trading moves the pool's proportion of USDC to USDT tokens briefly away from the 1:1 point and decreases when balances return to the 1:1 point. The protocol requires that `refPerTok()` never decreases, so this will cause defaults. Even with a large amount of revenue hiding, it may be possible for a griefer to flash loan enough USDC to intentionally swing the pool enough to trigger a default.

Alternatively, you might imagine "0.5 USDC + 0.5 USDT" could be the reference unit. _This also won't work_, because now `refPerTok()` will decrease any time the pool's proportion moves away from the 1:1 point, and it will increase whenever the proportion moves back, as before.

To make this Collateral position actually work, we have to account revenues against the pool's invariant. Assuming that there's a supply of `L` LP tokens for a pool with `x` USDC and `y` USDT, the strange-looking reference unit `sqrt(USDC * USDT)`, with corresponding `refPerTok() = sqrt(x * y)/L`, works exactly as desired.

Without walking through the algebra, we can reason our way heuristically towards this design. The exchange rate `refPerTok()` should be a value that only ever increases. In UNI V2, that means it must not change when LP tokens are deposited or withdrawn; and it must not change due to trading, except insofar as it increases due to the protocol's fees. Deposit and withdrawal change all of `x`, `y`, and `L`, but in a lawful way: `x * y / (L * L)` is invariant even when the LP supply is changed due deposits or withdrawals. If there were zero fees, the same expression would be invariant during trading; with fees, `x * y` only increases, and so `x * y / (L * L)` only increases. However, this expression has bizarre units. However, this expression cannot possibly be a rate "per LP token", it's a rate per square of the LP token. Taking the square root gives us a rate per token of `sqrt(x * y) / L`.

After this choice after reference unit, we have two reasonable choices for target units. The simplest choice is to assert that the target unit is essentially unique to this particular instance of UNI v2 -- named by some horrible unique string like `UNIV2SQRTUSDTCUSDT` -- and that its redemption position cannot be traded, for certain, for any other backup position, so it cannot be backed up by a sensible basket.

This would be sensible for many UNI v2 pools, but someone holding value in a two-sided USD-fiatcoin pool probably intends to represent a USD position with those holdings, and so it'd be better for the Collateral plugin to have a target of USD. This is coherent so long as all tokens in the pool are pegged to USD.

### Revenue Hiding

Revenue Hiding should be employed when the function underlying `refPerTok()` is not necessarily _strongly_ non-decreasing, or simply if there is uncertainty surrounding the guarantee. In general we recommend including a very small amount (1e-6) of revenue hiding for all appreciating collateral. This is already implemented in [AppreciatingFiatCollateral.sol](../contracts/plugins/assets/AppreciatingFiatCollateral.sol).

When implementing Revenue Hiding, the `price` function should NOT hide revenue; they should use the current underlying exchange rate to calculate a best-effort estimate of what the collateral will trade at on secondary markets. A side-effect of this approach is that the RToken's price on markets becomes more variable.

## Important Properties for Collateral Plugins

### Oracles must not be plausibly manipulable

It must not be possible to manipulate the oracles a collateral relies on, cheaply. In particular (though not limited to): it should not be possible to manipulate price within the block.

### Reuse of Collateral Plugins

Collateral plugins should be safe to reuse by many different Reserve Protocol instances. So:

- Collateral plugins should neither require governance nor give special permissions to any particular accounts.
- Collateral plugins should not pull information from an RToken instance that they expect to use them directly. Check out [CurveStableRTokenMetapoolCollateral.sol](../contracts/plugins/assets/curve/CurveStableRTokenMetapoolCollateral.sol) for an example of a collateral plugin that allows one RToken instance to use another RToken instance as collateral, through an LP token.

### Token balances must be transferrable

Collateral tokens must be tokens in the formal sense. That is: they must provide balances to holders, and these balances must be transferrable.

Some positions may not be transferrable: take for example DSR-locked DAI or Convex's boosted staking positions. In these cases tokenization can be achieved by wrapping the position. In this kind of setup the wrapping contract issues tokens that correspond to pro-rata shares of the overall defi position, which it maintains under the hood in relation with the defi protocol.

Here are some examples of what this looks like in Convex's case [here](https://github.com/convex-eth/platform/tree/main/contracts/contracts/wrappers).

### Token balances cannot be rebasing

Some defi protocols yield returns by increasing the token balances of users, called _rebasing_. For instance, ATokens from Aave and stETH from Lido are both rebasing tokens. While people often like this, smart contracts certainly do not.

The Reserve Protocol cannot directly hold rebasing tokens. However, the protocol can indirectly hold a rebasing token, if it's wrapped by another token that does not itself rebase, but instead appreciates only through exchange-rate increases. Any rebasing token can be wrapped to be turned into an appreciating exchange-rate token, and vice versa.

To use a rebasing token as collateral backing, the rebasing ERC20 needs to be replaced with an ERC20 that is non-rebasing. This is _not_ a change to the collateral plugin contract itself. Instead, the collateral plugin designer needs to provide a wrapping ERC20 contract that RToken issuers or redeemers will have to deposit into or withdraw from.

There is a simple ERC20 wrapper that can be easily extended at [RewardableERC20Wrapper.sol](../contracts/plugins/assets/erc20/RewardableERC20Wrapper.sol). You may add additional logic by extending `_afterDeposit()` or `_beforeWithdraw()`.

### Token decimals should be <= 21

The protocol currently supports collateral tokens with up to 21 decimals. There are some caveats to know about:

- Tokens with 21 decimals must be worth at least `$1` at-peg
- Tokens with 18 decimals must be worth at least `$0.001` at-peg

These constraints only apply to pricing when the collateral is SOUND; when the collateral status is IFFY or DISABLED the price is allowed to fall below these thresholds.

### `refresh()` should never revert

Because it’s called at the beginning of many transactions, `refresh()` should never revert. If `refresh()` encounters a critical error, it should change the Collateral contract’s state so that `status()` becomes `DISABLED`.

To prevent `refresh()` from reverting due to overflow or other numeric errors, the base collateral plugin [Fiat Collateral](../contracts/plugins/assets/FiatCollateral.sol) has a `tryPrice()` function that encapsulates both the oracle lookup as well as any subsequent math required. This function is always executed via a try-catch in `price()`/`refresh()`. Extenders of this contract should not have to override any of these three functions, just `tryPrice()`.

### The `IFFY` status should be temporary.

If a contract's `status()` has been `IFFY` on every call to `refresh()` for some (configured, finite) amount of time, then the status() should become `DISABLED`.

Unless there's a good reason for a specific collateral to use a different mechanism, that maximum `IFFY` duration should be a parameter given in the Collateral plugin's constructor.

### Collateral cannot be SOUND if `price().low` is 0

If `price()` returns 0 for the lower-bound price estimate `low`, the collateral should pass-through the [slow default](#types-of-default) process where it is first marked `IFFY` and eventually transitioned to `DISABLED` if the behavior is sustained. `status()` should NOT return `SOUND`.

If a collateral implementor extends [Fiat Collateral](../contracts/plugins/assets/FiatCollateral.sol) or [AppreciatingFiatCollateral.sol](../contracts/plugins/assets/AppreciatingFiatCollateral.sol), the logic inherited in the `refresh()` function already satisfies this property.

### Collateral must default if `refPerTok()` falls.

Notice that `refresh()` is the only non-view method on the ICollateral interface, so it's the only place that can deal with a state change like this. `refresh()` is carefully called by any flow through the RToken protocol that requires good prices or sound collateral. So, we need just the following quite specific property:

If `refresh()` is called twice, and `refPerTok()` just after the second call is lower than `refPerTok()` just after the first call, then `status()` must change to `CollateralStatus.DISABLED` immediately. This is true for any collateral plugin. For some collateral plugins it will be obvious that `refPerTok()` cannot decrease, in which case no checks are required.

If a collateral implementor extends [Fiat Collateral](../contracts/plugins/assets/FiatCollateral.sol), the logic inherited in the `refresh()` function already satisfies this property.

### Defaulted Collateral must stay defaulted.

If `status()` ever returns `CollateralStatus.DISABLED`, then it must always return `CollateralStatus.DISABLED` in the future.

### Token rewards should be claimable.

Protocol contracts that hold an asset for any significant amount of time must be able to call `claimRewards()` _on the ERC20 itself_, if there are token rewards. The ERC20 should include whatever logic is necessary to claim rewards from all relevant defi protocols. These rewards are often emissions from other protocols, but may also be something like trading fees in the case of UNIV3 collateral. To take advantage of this:

- `claimRewards()` must claim all rewards that may be earned by holding the asset ERC20 and send them to the holder, in the correct proportions based on amount of time held.
- The `RewardsClaimed` event should be emitted for each token type claimed.

### Smaller Constraints

For a Collateral contract, `isCollateral()` always returns `true`.

The values returned by the following view methods should never change:

- `targetName()`
- `erc20()`
- `erc20Deciamls()`

## Function-by-function walkthrough

Collateral implementors who extend from [Fiat Collateral](../contracts/plugins/assets/FiatCollateral.sol) or [AppreciatingFiatCollateral.sol](../contracts/plugins/assets/AppreciatingFiatCollateral.sol) can restrict their attention to overriding the following three functions:

- `tryPrice()` (not on the ICollateral interface; used by `price()`/`refresh()`)
- `refPerTok()`
- `targetPerRef()`

### refresh()

`function refresh() public`

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

`status()` should trigger `DISABLED` when `refresh()` can tell that its assumptions are definitely being violated, and `status()` should trigger `IFFY` if it cannot tell that its assumptions _aren't_ being violated, such as if an oracle is reverting or has become stale.

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

After a call to `refresh()`, it is expected the collateral is either `IFFY` or `DISABLED` if either `refPerTok()` or `targetPerRef()` might revert, or if `price()` would return a 0 value for `low`.

The collateral should also be immediately set to `DISABLED` if `refPerTok()` has fallen.

A Collateral plugin may become `DISABLED` for other reasons as well. For instance, if an ERC20 represents a bridged asset, the Collateral should monitor the exchange rate to the canonical asset for deviations. A sustained period of deviation, or simply stale oracle data, should result in the collateral eventually becoming `DISABLED`.

As long as it observes such a price irregularity, the Collateral's `status()` should return `IFFY`. It is up to the collateral how long the `IFFY` period lasts before the collateral becomes `DISABLED`, but it is critical that this period is finite and relatively short; this duration should probably be an argument in the plugin's constructor.

Lastly, once a collateral becomes `DISABLED`, it must remain `DISABLED`.

### price() `{UoA/tok}`

Should never revert.

Should return the tightest possible lower and upper estimate for the price of the token on secondary markets.

The difference between the upper and lower estimate should not exceed 5%, though this is not a hard-and-fast rule. When the difference (usually arising from an oracleError) is large, it can lead to [the price estimation of the RToken](../contracts/plugins/assets/RTokenAsset.sol) somewhat degrading. While this is not usually an issue it can come into play when one RToken is using another RToken as collateral either directly or indirectly through an LP token. If there is RSR overcollateralization then this issue is mitigated.

Lower estimate must be <= upper estimate.

Under no price data, the low estimate shoulddecay downwards and high estimate upwards.

Should return `(0, FIX_MAX)` if pricing data is _completely_ unavailable or stale.

Should NOT return `(>0, FIX_MAX)`: if the high price is FIX_MAX then the low price must be 0.

Should be gas-efficient.

### refPerTok() `{ref/tok}`

Should never revert.

Should never decrease. The plugin should monitor this value for decrease in its `refresh()` function if necessary.

Should be gas-efficient.

### targetPerRef() `{target/ref}`

Should never revert. Must return a constant value. Almost always `FIX_ONE`, but can be different in principle.

Should be gas-efficient.

### isCollateral()

Should return `True`.

### targetName()

The target name is just a bytes32 serialization of the target unit string. Here are some common values below:

- USD: `0x5553440000000000000000000000000000000000000000000000000000000000`
- EUR: `0x4555524f00000000000000000000000000000000000000000000000000000000`
- ETH: `0x4554480000000000000000000000000000000000000000000000000000000000`
- BTC: `0x4254430000000000000000000000000000000000000000000000000000000000`

For a collateral plugin that uses a novel target unit, get the targetName with `ethers.utils.formatBytes32String(unitName)`.

### savedPegPrice() `{target/ref}`

A return value of 0 indicates _no_ issuance premium should be applied to this collateral during de-peg. Collateral that return 0 are more dangerous to be used inside RTokens as a result.

Should never revert.

Should be gas-efficient.

## Practical Advice from Previous Work

In most cases [Fiat Collateral](../contracts/plugins/assets/FiatCollateral.sol) or [AppreciatingFiatCollateral.sol](../contracts/plugins/assets/AppreciatingFiatCollateral.sol) can be extended, pretty easily, to support a new collateral type. This allows the collateral developer to limit their attention to the overriding of three functions: `tryPrice()`, `refPerTok()`, `targetPerRef()`.

If you're quite stuck, you might also find it useful to read through our existing Collateral plugins, found at `/contracts/plugins/assets`.
