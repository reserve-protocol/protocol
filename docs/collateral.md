# Writing Collateral Plugins

This document describes what a developer needs to know to begin writing and contributing collateral plugins.

## Background

The core protocol depends on two **plugin** types:

1. _Asset / Collateral_
   `contracts/plugins/assets`
2. _Trading_ (not discussed here)
   `contracts/plugins/trading`

In our inheritance tree, Collateral is a subtype of Asset (i.e. `ICollateral is IAsset`). An Asset desribes how to interact with and price an ERC20 token. If a token is to handled by the protocol, it requires an Asset plugin contract. This contract must be registered with the `AssetRegistry` associated with the RToken instance in consideration.

A Collateral is everything an Asset is and more:

- Its ERC20 token can be used to back an RToken, not just be bought and sold
- A Collateral has a `refresh()` method that is called at the start of any significant system interaction (i.e. `@custom:interaction`).
- A Collateral has a `status()` view that returns a `CollateralStatus` enum. Must be one-of: `SOUND/IFFY/DISABLED`.
- A Collateral provides 3 exchange rates in addition to the `{UoA/tok}` prices provided by an Asset: (i) `{ref/tok}` (ii) `{target/ref}` (iii) `{UoA/target}`. A large part of creating a collateral plugin is deciding what these units are. Later on we discuss this in detail. (If this unit notation is entirely new to you, we suggest you check out `docs/solidity-style.md#Units-in-comments`. More below in the `Accounting Units` section.)

A portion of the `IAsset.sol` interface file is included below:

```
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

### Accounting Units

The first thing a collateral plugin designer needs to do is select the 3 accounting units for the collateral token in consideration. For the most part this boils down to finding some **reference unit that the collateral unit never depreciates with respect to**.

#### Collateral unit `{tok}`

Choosing the collateral unit is straightforward: it's just the ERC20 token being used as collateral. This is the token that will be directly held by the protocol instance. This is usually a token that is interesting to hold because it allows the accumulation of ever-increasing amounts of some other more-fundamental unit, called the reference unit. It's also possible for collateral to be non-appreciating, in which case it may still make sense to hold the collateral either because it allows the claiming of rewards over time, or simply because the protocol strongly requires stability (usually, short-term).

Note that `{tok}` is in "whole tokens" with 18 decimals. So even though DAI has 18 decimals and USDC has 6 decimals, $1 in either token would be 1e18 when working in units of `{tok}`. For more about our approach for handling decimal-fixed-point, check out `docs/solidity-style.md#The-Fix-Library`.

#### Reference unit `{ref}`

Choosing the reference unit is often less obvious, and in some cases requires some real creativity. Remember: the collateral unit cannot fall against the reference unit. To discover the reference unit for the collateral in question, you'll need to ask the question: **What is a unit that this collateral token will always be worth the same or more of, unless something terrible has happened?**

In some cases the choice of reference unit comes naturally. For example:

- The collateral token USDT would have a reference unit of USDT. USDT is non-appreciating as a collateral.
- The collateral token cUSDC (compound USDC) would have a reference unit of USDC. cUSDC monotonically appreciates relative to USDC, meaning as blocks pass it becomes redeemable for more USDC. It is designed to never decrease in redeemability.

It's often the case that the collateral token is directly redeemable for the reference unit, but this isn't necessary in principle. The protocol never holds the reference unit directly; it's just an internal accounting mechanism used to determine when yield has occurred. This permits the creation of synthetic reference units, which are certainly more advanced. If you want to keep things simple, stick to simple collateral that have a monotonically increasing exchange rate to the token they can be redeemed for.

##### Synthetic reference units (advanced)

In some cases, a synthetic reference unit will be required. Let's take the case of the **UNIV2LP** token for a like-kind stablecoin pool such as the USDC/USDT pair.

(Note: In UNIV2 trading fees are automatically re-invested back into the pool)

- What does the LP token _strictly appreciate_ relative to?
  It's tempting to say the LP token strictly appreciates relative to the number of USDC + USDT in the pool, but this isn't actually true. Let's see why.
  When the price moves away from the 1:1 point, more tokens are taken in than are given away. From the trader's perspective, this is a "bad" price, assuming both USDC and USDT have not lost their peg. As long as the trade moves the pool further away from the 1:1 point, then it's true that the sum of USDC + USDT balances in the pool increases monotonically.
  But we can't count on this always being the case! Any trade that returns the pool closer to the 1:1 point is "good" from the trader's perspective; they buy more USD stablecoin than they sell. When the pool is imbalanced, it might be willing to sell 101 USDC for 100 USDT. In this case, using the raw total of USDC + USDT balances would result in a measure that sometimes decreases with respect to the LP token. Even though this happens rarely, this means **it would not work to use the sum of the USDC + USDT balances as the reference unit for an LP token**.
- But, with a little creativity, we can come up with a synthetic unit that _does_ have the property we care about. How? In general the approach that will work here is to look for some type of floor measure that we can be confident will never decrease. Here is a candidate measure:

  Let the reference unit be the sum of _stored_ USDC and USDT balances, where stored values are updated latently/pessimistically. That is: when examining token balances, only look at the minority side of the pool, and only update the stored token balance if it exceeds the previously stored balance.

  (Note: This explanation assumes a constant LP token balance. In practice this will likely have to be implemented via tracking two exchange rates in order to account for RToken issuances/redemptions that may change how many LP tokens are held. Pseudocode below.)

  ```
  refresh():
    maxRate = max(USDC/LP, USDT/LP)
    a = max(a, USDC/LP) if USDC/LP <= maxRate else a
    b = max(b, USDT/LP) if USDT/LP <= maxRate else b
  ```

If this seems confusing, that's because it is kind of confusing. At the time of this writing, this repo does not yet contain a collateral plugin with a synthetic reference unit, and that is because they are genuinely difficult to write! We recommend only the bravest head down this path.

##### Common Misconceptions

A common misconception around the reference unit is that USD is the natural reference unit for a stablecoin or stablecoin derivative like cUSDC. But remember: there are small price movements around $1 even for the stablest of stablecoins! This is where the target unit comes in.

#### Target unit `{target}`

The target unit has to do with a concept called the Target Basket, and ultimately comes down to _the reasons why this collateral might be chosen as backing in the first place_.

(Note: the Target Basket never manifests in the code directly. In the code, we have a slightly more specific concept called the Prime Basket. But the Target Basket is a coherent concept for someone thinking about the UX of an RToken. You can think of it like a simplified view of the Prime Basket.)

When creating an RToken in the Register, the deployer selects a linear combination of target units such as:

- 1 USD
- 0.5 USD + 0.55 EURO
- 0.5 USD + 0.35 EURO + 0.00001 BTC

Here all of these Target Baskets have been selected to start out roughly around \$1, assuming a slightly weak EURO and \$20k BTC. Over time however, each of these RTokens will have very different overall price trajectories from any vantage point.

Fortunately it's not so hard to figure out the target unit for a particular collateral plugin, at least once you've figured out the correct reference unit. **The target unit should be chosen such that the reference unit can be expected to roughly track the target unit, modulo short-term price deviations.** For USDC the target unit would be USD; for EURT it would be the EURO; for WBTC it would be BTC.

It is important to implement checks in the collateral plugin that the target unit is indeed tracking the reference unit. More on this later.

#### Unit of Account `{UoA}`

The Unit of Account `{UoA}` for a collateral plugin is entirely general _in principle_, but in practice it needs to be something that all the other collateral plugins used within an RToken can also support. Maybe in some future world we'll have enough EURO or big mac price information on-chain, but for now USD prices are king so it is probably correct to assume `UoA = USD`.

This doesn't disqualify collateral with USD as its target unit! Nor does it disqualify collateral with a non-USD target unit! These concepts are entirely orthogonal.

Ok, that was a lot about the theory behind our accounting units. Below are some important properties for Collateral Plugins.

## Important Properties for Collateral Plugins

### Collateral plugins should be permisionless and should be able to be used by any number of RTokens simultaneously

### Token balances cannot be rebasing

Some defi protocols have chosen to provide returns in the form of an increasing token balance, called a rebase. ATokens from Aave and stETH from Lido are both rebasing tokens: over time token balances simply increase of their own accord. While people tend to like this, smart contracts certainly don't. In order to have a rebasing token be handled by the protocol, **it must be wrapped** to be turned into a token that appreciates solely via exchange rate increases.

In general any rebasing token can be wrapped to be turned into an appreciating exchange rate token, and vice versa. It's even possible to split the difference, if you want. But for a token to be used in the Reserve protocol as collateral, it's important that _all_ rebasing be eliminated from the token.

For an example of what a token wrapper that performs this transformation looks like, check out `contracts/plugins/aave/StaticATokenLM.sol`. This is a standard wrapper used by many protocols to wrap Aave ATokens into StaticATokens.

### `refresh()` should never revert

Because it’s called at the beginning of many transactions, `refresh()` should never revert. If it’s important to indicate a critical error, `refresh()` should change the Collateral contract’s state so that `status()` becomes `DISABLED`.

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
- `getClaimCalldata()` should return a contract address and calldata `bytes` that an asset-storing contract can use to make a raw function call to claim its rewards. For more on preparing this call, check out the use of `abi.encodeWithSignature()` in `contracts/plugins/assets/CTokenFiatCollateral.sol`.

### Smaller Constraints

For a Collateral contract, `isCollateral()` always returns `true`.

The values returned by the following view methods should never change:

- `targetName()`
- `erc20()`
- `rewardERC20()`
- `erc20Deciamls()`

## Function-by-function walkthrough

This next section goes function-by-function. It is somewhat redundant with the `Important Properties for Collateral Plugins` above, but with a slightly different lens.

### refresh()

`function refresh() external`

Because `refresh()` is called so frequently, it is important that **it only reverts under out-of-gas** errors. This often means wrapping any risky external calls that might throw in a try-catch block like this one:

```
try externalLibrary.call() returns (bool) {
    markStatus(...)
    ...
} catch (bytes memory errData) {
    if (errData.length == 0) revert(); // this is what OOG looks like
    ...
    markStatus(...) // a helper from `contracts/plugins/assets/AbstractCollateral` that may or may not be useful
}
```

(For more context on catching OOG errors, see: docs/solidity-style.md#Catching-Empty-Data)

If `refresh()` changes the current CollateralStatus, a `CollateralStatusChanged` event should be emitted.

You are welcome to include additional mutators on a Collateral plugin, but `refresh()` is the only one that will be called within the lifecycle of a typical protocol interaction.

If something can go wrong with the collateral plugin, it is important to check for this in the body of `refresh()` and mark the CollateralStatus to `IFFY` or `DISABLED` appropriately. Depending on the type of default, it may be correct to first enter `IFFY`, or jump directly to `DISABLED`.

#### Types of Default

Broadly speaking there are two ways a collateral can default:

1. Fast: An issue with the defi protocol might be detected, which should result in an immediate default. The `{ref/tok}` exchange rate falling should _always_ result in an immediate default. There may be other reasons for fast default depending on the defi protocol of the collateral plugin.
2. Slow: An issue with the link between the reference unit and the target unit might be detected, leading to a slow default. If, for example, USDT is trading at \$0.94 for a significant period of time (say 24h), this is a good reason to default the collateral. If oracles are stale or reverting for a significant period of time, this is another good reason to default the collateral. In either of these cases, the collateral should first become `IFFY` and only move to `DISABLED` after the problem becomes sustained. In general any pathway for default that cannot be assessed immediately should go through this delayed flow.

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

And if `refPerTok()` has fallen, the collateral should be immediately set to `DISABLED`.

However, a collateral plugin may want to become `DISABLED` for other reasons as well. In the case of an ERC20 token that represents a bridged asset, the collateral should monitor the exchange rate to the canonical asset for deviation or staleness. A sustained period of deviation or simply stale oracle data should result in the collateral becoming `DISABLED`, eventually.

During the period the price deviation / price staleness / reverting price is observed, the collateral should return a status of `IFFY`. It is up to the collateral how long the `IFFY` period lasts before the collateral becomes `DISABLED`, but it is critical that this period is finite and relatively short. The collateral plugin should probably take this length of time as an argument in its constructor.

Lastly, it is crucial that defaulted collateral remains defaulted; once a collateral becomes `DISABLED`, it should remain `DISABLED`.

### strictPrice() `{UoA/tok}`

Should revert if pricing data is unavailable.

Should act identically to `price(false)`.

Should not be gas-costly.

### price(bool) `{UoA/tok}`

Can revert if `False`. Should not revert if `True`.

Can use fallback pricing data if `True`.

Should not be gas-costly.

### refPerTok() `{ref/tok}`

Should never revert.

Should never decrease. The plugin should monitor this value for decrease in its `refresh()` function if necessary.

Should not be gas-costly.

### targetPerRef() `{target/ref}`

Should never revert. May decrease. The plugin should monitor this value for deviation in its `refresh()` function if it is possible for the reference unit to diverge from the target unit.

Should not be gas-costly.

### pricePerTarget() `{UoA/target}`

Should never revert. May decrease or increase or do anything, really. Monitoring for deviation does not make sense here.

Should not be gas-costly.

### isCollateral()

Should return `True`.

### targetName()

The target name is just a bytes32 serialization of the target unit string. Here are some common values below:

- USD: `0x5553440000000000000000000000000000000000000000000000000000000000`
- EURO: `0x4555524f00000000000000000000000000000000000000000000000000000000`
- ETH: `0x4554480000000000000000000000000000000000000000000000000000000000`
- BTC: `0x4254430000000000000000000000000000000000000000000000000000000000`

For a collateral plugin that uses a novel target unit, you'll want to use `ethers.utils.formatBytes32String`.

## Practical Advice / Previous Work

In our own collateral plugin development we found it useful to have a common abstract class that we extended, but it's not obvious this is going to be right for all future collateral plugins. We recommend you read through `contracts/plugins/assets/AbstractCollateral.sol` and its parent class `contracts/plugins/assets/Asset.sol` to determine this for yourself. Even if you decide not to extend, we think it's likely you'll find it useful to copy some of the helper methods or ways of thinking about the problem.

For an example of a fairly simple collateral plugin that still requires unique accounting units, check out `contracts/plugins/assets/CTokenFiatCollateral.sol`, which is for a fiat-pegged stablecoin that has been placed into Compound such as cUSDC/cUSDT/cDAI/cUSDP. You may also find it useful to read through the full set of collateral plugins, which can be found as sibling files of `CTokenFiatCollateral.sol`.
