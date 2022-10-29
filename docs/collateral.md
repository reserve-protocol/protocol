# Writing Collateral Plugins

This document describes what a developer needs to know to begin writing and contributing collateral plugins.

## Background

The core protocol depends on two plugin types:

1. _Asset / Collateral_
   `contracts/plugins/assets`
2. _Trading_ (not discussed here)
   `contracts/plugins/trading`

In our inheritance tree, Collateral is a subtype of Asset (i.e. `ICollateral is IAsset`). An Asset describes how to interact with and price an ERC20 token. An instance of the Reserve Protocol can use an ERC20 token if and only if its `AssetRegistry` contains an asset modelling that token. An Asset provides the Reserve Protocol with information about the token:

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

    // ==== Rewards ====

    /// Get the message needed to call in order to claim rewards for holding this asset.
    /// Returns zero values if there is no reward function to call.
    /// @return _to The address to send the call to
    /// @return _calldata The calldata to send
    function getClaimCalldata() external view returns (address _to, bytes memory _calldata);

    /// The ERC20 token address that this Asset's rewards are paid in.
    /// If there are no rewards, will return a zero value.
    function rewardERC20() external view returns (IERC20 reward);
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

    /// @return {UoA/target} The price of the target unit in UoA (usually this is {UoA/UoA} = 1)
    function pricePerTarget() external view returns (uint192);
}

```

## Accounting Units and Exchange Rates

To create a Collateral plugin, you need to select its accounting units (`{tok}`, `{ref}`, `{target}`, and `{UoA}`), and implement views of the exchange rates between those units: `refPerTok()`, `targetPerRef()`, and `pricePerTarget`.

Typical accounting units in this sense are things like ETH, USD, USDC -- tokens, assets, currencies; anything that can be used as a measure of value. In general, a valid accounting unit is a linear combination of any number of assets; so (1 USDC + 0.5 USDP + 0.25 TUSD) is a valid unit, as is (say) (0.5 USD + 0.5 EUR), though such units will probably only arise in particularly tricky cases. Each Collateral plugin should describe in its documentation each of its four accounting units

As a quick overview:
- The unit `{tok}` is just the concrete token being modelled.
- The protocol measures growth as the increase of the value of `{tok}` against the value of `{ref}`, and treats that growth as revenue.
- If two Collateral plugins have the same `{target}`, then when one defaults, the other one can serve as backup collateral.
- The unit `{UoA}` is a common accounting unit across all collateral in an RToken.

### Collateral unit `{tok}`

The collateral unit `{tok}` is just 1 of the ERC20 token that the Collateral plugin models. The protocol directly holds this unit of value.

This is typically a token that is interesting to hold because it allows the accumulation of ever-increasing amounts of some other more-fundamental unit, called the reference unit. It's also possible for collateral to be non-appreciating, in which case it may still make sense to hold the collateral either because it allows the claiming of rewards over time, or simply because the protocol strongly requires stability (usually, short-term).

Note that a value denoted `{tok}` is a number of "whole tokens" with 18 decimals. So even though DAI has 18 decimals and USDC has 6 decimals, $1 in either token would be 1e18 when working with `uint192` values with the unit `{tok}`. For context on our approach for handling decimal-fixed-point, see  [docs/solidity-style.md#The-Fix-Library](solidity-style.md#The-Fix-Library).

### Reference unit `{ref}` ###

The _reference unit_, `{ref}`, is the measure of value that the protocol computes revneue against. When the exchange rate `refPerTok()` rises, the protocol keeps a constant amount of `{ref}` as backing, and sells the rest of the token it holds as revenue.

There's room for flexibility and creativity in the choice of a Collateral's reference unit. The chief constraints are:

- `refPerTok() {ref}` should always be a good market rate for 1 `{tok}`
- `refPerTok()` must be nondecreasing over time, at least on some sensible model of the collateral token's economics. If that model is violated, the Collateral plugin should immediately default. (i.e, permanently set `status()` to `DISABLED`)

In many cases, the choice of reference unit is clear. 

- The collateral token cUSDC (compound USDC) has a natural reference unit of USDC. cUSDC is permissionlessly redeemable in the Compound protocol for an ever-increasing amount of USDC.
- The collateral token USDT is its own natural reference unit. It's not natively redeemable for anything else on-chain, and we think of it as non-appreciating collateral. (Consider: what would it mean for USDT to "appreciate"?)

Often, the collateral token is directly redeemable for the reference unit in the token's protocol. (When this is the case, you can usually implement `refPerTok()` by looking up the redemption rate between the collateral token and its underlying token!) If you want to keep things simple, stick to "natural" collateral produced by protocols with nondecreasing exchange rates.

However, the protocol never tries to handle reference-unit tokens itself, and in fact reference-unit tokens don't even need to exist. Thus, a Collateral can have a  _synthetic_ reference unit for which there exists no corresponding underlying token. For some worked-out examples, read [Synthetic Unit Examples](#Synthetic_Unit_Examples) below.

### Target unit `{target}` ###

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

### Unit of Account `{UoA}` ###

The Unit of Account `{UoA}` for a collateral plugin is simply a measure of value in which asset prices can be commonly denominated and compared. In principle, it's totally arbitrary, but all collateral plugins registered with an RToken must have the same unit of account. As of the current writing (October 2022), given the price information currently available on-chain, just use `USD` for the Unit of Account.

Note, this doesn't disqualify collateral with USD as its target unit! It's fine for the target unit to be the unit of account. This doesn't disqualify collateral with a non-USD target unit either! It's fine for the target unit to be different from the unit of account. These two concepts are totally orthogonal.

## Synthetic Unit Examples

[comment]: I haven't tried editing this section yet, because I'm running out of time today and I'm not all that certain that it's _right_. Needs more work...

In some cases, a synthetic reference unit will be required. Let's take the case of an **UNIV2LP** token for a like-kind stablecoin pool such as the USDC/USDT pair.

(Note: In UNIV2 trading fees are automatically re-invested back into the pool)

- What does the LP token _strictly appreciate_ relative to?
  It's tempting to say the LP token strictly appreciates relative to the number of USDC + USDT in the pool, but this isn't actually true. Let's see why.
  When the price moves away from the 1:1 point, more tokens are taken in than are given away. From the trader's perspective, this is a "bad" price, assuming both USDC and USDT have not lost their peg. As long as the trade moves the pool further away from the 1:1 point, then it's true that the sum of USDC + USDT balances in the pool increases monotonically.
  But we can't count on this always being the case! Any trade that returns the pool closer to the 1:1 point is "good" from the trader's perspective; they buy more USD stablecoin than they sell. When the pool is imbalanced, it might be willing to sell 101 USDC for 100 USDT. In this case, using the raw total of USDC + USDT balances would result in a measure that sometimes decreases with respect to the LP token. Even though this happens rarely, this means **it would not work to use the sum of the USDC + USDT balances as the reference unit for an LP token**.

Fortunately, each AMM pool has _some_ invariant it preserves in order to quote prices to traders. In the case of UNIV2, this is the constant-product formula `x * y = k`, where `x` and `y` are the token balances. This means `x * y` adheres to our monotonically increasing constraint already; the product can never fall.

However, its units are wrong. We need to the square root of the product in order to get back to a (synthetic) token balance. [TODO: expand this justification]

A good reference unit for a UNIV2 position is: `sqrt( USDC.balanceOf(pool) * USDT.balanceOf(pool))`

In general this is extensible to any AMM curve on any number of tokens. For Curve/Balancer, one would only need to replace the inside of the expression above with the pool invariant and alter the `sqrt` to be an `n-root` where `n` is the number of tokens in the pool.

In its general form this looks like: `( amm_invariant ) ^ (1/num_tokens)`


## Important Properties for Collateral Plugins

### Reuse of Collateral Plugins 

Collateral plugins should be safe to reuse by many different Reserve Protocol instances. So:

- Collateral plugins should neither require governance nor give specal permissions to any particular accounts.
- Collateral plugins should not pull information from an RToken instance that they expect to use them directly. (There is already an RToken Asset that uses price information from the protocol directly; but it must not be extended for use as Collateral in its own basket!)

### Token balances cannot be rebasing

Some defi protocols indicate returns by increasing the token balances of users, called _rebasing_. For instance, ATokens from Aave and stETH from Lido are both rebasing tokens. While people often to like this, smart contracts certainly do not. 

The Reserve Protocol cannot directly hold rebasing tokens. However, the protocol can indirectly hold a rebasing token, if it's wrapped by another token that does not itself rebase, but instead appreciates only through exchange-rate increases. Any rebasing token can be wrapped to be turned into an appreciating exchange-rate token, and vice versa.

To use a rebasing token as collateral backing, the rebasing ERC20 needs to be replaced with an ERC20 that is non-rebasing. This is _not_ a change to the collateral plugin contract itself. Instead, the collateral plugin designer needs to provide a wrapping ERC20 contract that RToken issuers or redeemers will have to deposit into or withdraw from. We expect to automate these transformations as zaps in the future, but at the time of this writing everything is still manual.

For an example of a token wrapper that performs this transformation, see [StaticATokenLM.sol](../contracts/plugins/aave/StaticATokenLM.sol). This is a standard wrapper to wrap Aave ATokens into StaticATokens. A thinned-down version of this contract makes a good starting point for developing other ERC20 wrappers -- but if the token is well-integrated in defi, a wrapping contract probably already exists.

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

### Token rewards should be claimable.

Protocol contracts that hold an asset for any significant amount of time are all able to use `rewardERC20()` and `getClaimCalldata()` to claim rewards. These are often emissions from other protocols, but may also be something like trading fees in the case of UNIV3 collateral. To take advantage of this:

- `rewardERC20()` should return the reward token's address, and
- `getClaimCalldata()` should return a contract address and calldata `bytes` that an asset-storing contract can use to make a raw function call to claim its rewards. For more on preparing this call, check out the use of `abi.encodeWithSignature()` in [contracts/plugins/assets/CTokenFiatCollateral.sol](contracts/plugins/assets/CTokenFiatCollateral.sol).

### Smaller Constraints

For a Collateral contract, `isCollateral()` always returns `true`.

The values returned by the following view methods should never change:

- `targetName()`
- `erc20()`
- `rewardERC20()`
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

See also: [Catching Empty Data](docs/solidity-style.md#Catching-Empty-Data).

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
- `pricePerTarget()`

The collateral should also be immediately set to `DISABLED` if `refPerTok()` has fallen.

A Collateral plugin may become `DISABLED` for other reasons as well. For instance, if an ERC20 represents a bridged asset, the Collateral should monitor the exchange rate to the canonical asset for deviations. A sustained period of deviation, or simply stale oracle data, should result in the collateral becoming `DISABLED`.

As long as it observes such a price irregularity, the Collateral's `status()`  should return `IFFY`. It is up to the collateral how long the `IFFY` period lasts before the collateral becomes `DISABLED`, but it is critical that this period is finite and relatively short; this duration should probably be an argument in the plugin's constructor.

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

### pricePerTarget() `{UoA/target}`

Should never revert. May decrease, or increase, or do anything, really. Monitoring for deviation does not make sense here.

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

## Practical Advice from Previous Work

In our own collateral plugin development, we found it useful to implement Collateral plugins by extended a common, abstract contract. Consider subclassing [AbstractCollateral.sol](../contracts/plugins/assets/AbstractCollateral.sol) and its parent class [Asset.sol](../contracts/plugins/assets/Asset.sol) for your own Collateral plugin. 

For an example of a relatively simple Collateral plugin that nonetheless requires unique accounting units, see [CTokenFiatCollateral.sol](../contracts/plugins/assets/CTokenFiatCollateral.sol). It represents any USD-pegged stablecoin placed in Compound, such as cUSDC, cUSDT, cDAI, or cUSDP.

If you're quite stuck, you might also find it useful to read through our other Collateral plugins as models, found in our repository in `/contracts/plugins/assets`.
