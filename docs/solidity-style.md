# Our Solidity Style

Practices, details, and conventions relevant to reading and writing our Solidity source code.

Any subsection titled "Developer discipline" is describing a correctness property that we should carefully maintain in our code. That means:

- Avoid writing code that violates the property
- Check the property during code reviews
- I wish we had a static checker for the property

## uint192 as 18-digit decimal value

Throughout our system, any variable in state or memory, function parameter, or return value typed `uint192` is intended to be interpreted as a fixed-point decimal value, with 18 digits to the right of the decimal point. (Essentially, `ufixed192x18`, from the current [documentation][ufixed], if it was actually implemented.) In many places, these are referred to as "Fix" values for short.

[ufixed]: https://docs.soliditylang.org/en/develop/types.html#fixed-point-numbers

### The Fix library

`Fixed.sol` is a math library implementing the operations necessary to support this view of `uint192`. It defines a few common constants used elsewhere, especially `FIX_ONE` (The Fix representation of 1), `FIX_MAX` (The largest Fix value), and an enum of rounding directions `FLOOR`, `ROUND`, and `CEIL`.

These operations mostly come in a few classes:

- Conversion operations between Fix and and regular `uint` values: `toFix` and `toUint`
- Typical numeric operations like `plus`, `minus`, `mul`, `div`, `pow`, `lt`, `eq`, and so on
- Typical operations between Fix and unsigned int values, which have a `u` appended: `plusu`, `minusu`, `mulu`, `divu`
- A few special-case operations, inferrable from their datatypes. (For instance, `divuu(uint256 x, uint256 y) pure returns (uint192)` takes two unsigned integer values and returns their ratio as a Fix value, and `divFix(uint256 x, uint192 y) pure returns (uint192)` divides a Fix by an unsigned int, returning a Fix value.
- Chained operations, like `mulu_toUint` or `muluDivu`, which just to perform those operations in sequence.

Criticially, all of these operations are written so that they only fail with overflow errors if their result is outside the range of the return type. This is what motivates the chained operations, which are typically more expensive than their unchained analogues, but which do whatever work is necessary to avoid intermediate overflow. For instance:

```solidity
uint192 one = FIX_ONE;
uint256 big = type(uint256).max;
// This would trivially overflow:
one.mulu(big).divu(big / 2);
// But this will return 2 * FIX_ONE:
one.muludivu(big, big / 2;
```

The rounding directions `FLOOR`, `ROUND`, and `CEIL` can be optionally passed as the last parameter of many operations, especially `div*` and `mul*`, to describe whether implicit division should round up, down, or to the nearest available value.

### Why uint192?

We're using 192 bits instead of the full 256 bits because it makes typical multiplications and divisions substantially cheaper. 1e18 is a bit smaller than 2^64, so `mul(x,y)` and `div(x,y)` can be correctly implemented, without incorrect intermediate overflow, just using 256-bit arithmetic operations.

(We do use a double-width full-multiply and mul-div operation, but we avoid using them wherever we know we can avoid it, as they're much more expensive than simple arithmetic.)

Initial versions of this code were written using the custom type `Fix` everywhere, and `Fixed` contained the line `type Fix is int192`. We found later that:

- We had essentially no need for negative `Fix` values, so spending a storage bit on sign, and juggling the possibility of negative values, cost extra gas and harmed the clarity of our code.
- While `solc 0.8.9` allows custom types without any issue, practically all of the other tools we want to use on our Solidity source -- `slither`, `prettier`, `solhint` -- would fail when encountering substantial code using a custom type.

Reintroducing this custom type should be mostly mechanicanizable, but now that P1 contains a handful of hotspot optimizations that do raw arithmetic internally to eliminate Fixlib calls, it won't be trivial to do so. Still, if and when those tools achieve adequate support for custom types, we will probably do this conversion ourselves, if only to ensure that conversions between the Fix and integer interpretations of uints are carefully type-checked.

### Developer discipline

We don't have static checking for the following properties, so we have to maintain them through review.

Outside of Fixed.sol:

- NEVER allow a `uint192` to be implicitly upcast to `uint256`, without a comment explaining what is happening and why.
- NEVER explcitily cast between `uint192` and `uint256` without doing the appropriate numeric conversion (e.g, `toUint()` or `toFix()`.)
- ONLY use standard arithmetic operations on `uint192` values IF:
  - you're gas-optimizing a hotspot in P1 and need to remove Fixlib calls
  - in inline comments, you explain what you're doing and why

## Units in comments

In our implementation the units of variables (and many intermediate expressions!) are tracked in comments. Curly braces are used to denote units, like `{UoA/qTok}`.

The `q` prefix denotes "quantum", the smallest indivisible unit of a token.

The `atto` prefix [denotes 1e18][atto].

Otherwise, the unit is assumed to be whole. The meaning of a "whole" token changes depending on how many decimals that token has.

- `{qTok}` = token quantum
- `{tok}` = whole token = 1e6{qTok} (USDC) = 1e18{qTok} (DAI)
- `{ref}` = whole reference token (USDC is cUSDC's reference token)
- `{target}` = whole target unit (USD is cUSDC's target unit)
- `{BU}` = whole basket unit
- `{UoA}` = whole unit of the Unit of Account (which is probably USD)

Throughout our code, we use [dimensional analysis][] to guard against mistakes of reasoning, similar to type checking. (Except we don't have a type system that will actually do the static checking for us, so we have to be careful and verbose instead.)

### Developer discipline

- All declarations of state variables and interface parameters that represent a value with one of the above dimensions MUST have a comment naming their unit.
- Wherever those values are used in assignments in our code, the sides of the assignemnt MUST have the same dimensions.
  - Amid complex arithmetic, that the dimension are the same SHOULD be demonstrated in a nearby comment.

[atto]: https://en.wikipedia.org/wiki/Atto-
[dimensional analysis]: https://en.wikipedia.org/wiki/Dimensional_analysis

## Ranges of supported values

We want to ensure that handling large but reasonable values can never cause a revert due to overflow, but supporting arbitrary values would be very costly in terms of gas. To that end, this is our policy for the ranges of values that the protocol is intended to support.

The system should not revert due to overflow for any combination of values within the following ranges; any such reversion is an error.

Ranges here are formatted like "[min, max, granularity]" For instance, the range [0, 1e3, 1e-6] indicates the set of multiples of 1e-6 between 0 and 1000, inclusive. If a granularity isn't given, it's intended to be 1.

### Rates

- weights in the prime basket: [0, 1e3, 1e-6] `{target/BU}`
- the StRSR exchange rate: [1e-9, 1e9, 1e-9] `{stRSR/rsr}`
- the RToken exchange rate: [1e-9, 1e9, 1e-9] `{BU/rTok}`
- a result of `Collateral.pricePerTarget()`: [1e-9, 1e9, 1e-9] `{UoA/target}`
  - e.g UoA per USD
- a result of `Collateral.targetPerRef()`: [1e-9, 1e9, 1e-9] `{target/ref}`
  - e.g USD per USDC
- a result of `Collateral.refPerTok()`: [1e-9, 1e9, 1e-9] `{ref/tok}`
  - e.g USDC per cUSDC

### Financial Quantities

- `{attoUoA}`: [0, 1e47]
  - That's 1e29 `UoA`. When UoA is USD, this is about 250x the _square_ of the current M2 money supply.
- `{qRSR}`: [0, 1e29]
  - 1e29 is the fixed, total supply
- `{qStRSR}`: [0, 1e38]
  - 1e38 is 1e29 `{qRSR}` \* 1e9 (the max StRSR exchange rate)
- `{qRTok}`: [0, 1e48]
  - 10x the `attoUoA` maximum.
- `{qBU}`: [0, 1e57]
  - 1e57 is 1e48 `{qRTok}` \* 1e9 (the max RToken exchange rate)
- `{qTok}` of collateral tokens: [0, 2^256-1]
  - Just assume that collateral token quantities are any possible `uint256`.
- `{qTok}` of reward tokens: [0, 1e29]
  - These are typically fixed-supply, and 1e11 total tokens is the largest fixed supply we've encountered.

### Time

`{seconds}`: [0, 2^48-1]

That is, we expect timestamps to be any uint48 value.

This should work without change for around 9M years, which is more than enough.

## Function annotations

All core functions that can be called from outside our system are classified into one of the following 3 categories:

1. `@custom:interaction` - An action. Disallowed while paused. Per-contract reentrancy-safety is needed.
2. `@custom:governance` - Governance change. Allowed while paused.
3. `@custom:refresher` - Non-system-critical state transitions. Disallowed while paused, with the exception of `refresh()`.

All execution flows through the protocol should contain at most a single (1) action or (2) governance change. These

Functions that are not system-external, but are `external` and can be called by other contracts in the system, are tagged with `@custom:protected`. It is governance's job to ensure a malicious contract is never allowed to masquerade as a component and call one of these. They do not execute when paused.

For each `external` or `public` function, one of these tags MUST be in the correponding function's natSpec comments. We don't have a static checker for this property, but it needs to be maintained by all developers.

### `@custom:interaction`

- stRSR.stake()
- stRSR.unstake()
- stRSR.withdraw()
- rToken.issue()
- rToken.vest()
- rToken.cancel()
- rToken.redeem()
- {rsrTrader,rTokenTrader,backingManager}.settleTrade()
- backingManager.grantRTokenAllowances()
- backingManager.manageTokens\*()
- {rsrTrader,rTokenTrader}.manageToken()
- \*.claimAndSweepRewards()

### `@custom:governance`

- set\*()
  ...there are many and they are not worth naming individually

Governance functions acquire a lock at the beginning of execution, and can be executed while paused.

### `@custom:refresher`

- furnace.melt()
- stRSR.payoutRewards()
- assetRegistry.refresh()
- basketHandler.refreshBasket()

Note:

- `refresh` is a _strong_ refresher; we can even perform it while the system is paused. It's a refresher outside our system in some sense.
- `refreshBasket` is not _quite_ a refresher as it can cause other actions to cause differently depending on when it is called. It's pretty close though. Other functions should simply revert if they require a valid basket to perform their function.

## Reentrancy-safety

### Marking interactions

Some functions in our system are classed as interactions. In the natSpec comments, they're marked with the @custom:interaction annotation, both on their implementation and their interface.

A function must be classed as an interaction if it:

- Makes a non-view call to any contract outside our system, or
- Calls a function classed as an interaction

### Structuring interactions

As matters of policy, here are the three generic options for structuring interactions so that they're reentrancy-safe:

#### CEI pattern

Per the Checks-Effects-Interactions pattern, all interactions called by a function in our system must occur after any other:

- view calls to other contracts,
- writes to storage, or
- reads from storage,

... except that any interaction that relies on up-to-date collateral prices, or which needs to fail in the face of current-basket default, should call `AssetRegistry.refresh()` before reading or writing its own storage.

Roughly, this is exception is safe because we're doing this interaction before any state reading in the function; so the rest of the function is still operating from a consistent view of the world --- it's just the view from after a particular interaction instead of the view from before all interactions.

At the start of the Interactions block in a CEI-pattern function, set them off visually with a comment like: `// == Interactions ==`

When a function is an interaction made reentrancy-safe by the CEI pattern, follow its `@custom:interaction` mark with `CEI`, or with `RCEI` (R is for "Refresh") if it starts by calling `AssetRegistry.refresh()`.

#### ReentrancyGuard

Where using the CEI pattern is impractical, every function on that contract that is `external`, and can write to the relevant state elements, should use `reentrancyGuard`. That is, the contract should inherit from either `ReentrancyGuard` (or `ReentrancyGuardUpgradable` as needed), and every external function that can either modify contract state, or read it when it's inconsistent, should be marked with the `nonReentrant` modifier.

#### Exceptions

Anything that doesn't fit these two policies precisely must be carefully and fully documented inline, and added to this list:

- In `CTokenFiatCollateral`, `refresh()` follows the same general pattern as other contracts themselves using `AssetRegistry.refresh()`, and for the same reason; the initial refresher on the CToken contract ensures that prices are updated on the external contract, so that `refPerTok` can later access up-to-date values. This is safe by similar reasoning. (Alternately, if that reasoning is flawed, the same structure is probably a problem here!)

- `RToken.issue()` is almost but not quite in the CEI pattern; it treats `refundSpan` as something like a refresher, and is careful to reread any state necessary to achieve a consistent contract view afterwards.

- `RewardableLib.claimAndSweepRewards()`

- The entire `GnosisTrade` contract is using the moral equivalent of `ReentrancyGuard` to ensure its own reentrancy-safety, but since it's also using the state machine pattern, it can do both with the same state varible and save gas on SLOADs and SSTOREs.

### Reentrancy risk from collateral

For some collateral, we can only trust that we have up-to-date prices after we've called `refresh()` on that Collateral contract, during the same transaction. These functions can modify the state of external contracts, so in the usual security model in which we reason about reentrancy, they are potential vectors for reentrancy attacks.

Part of the responsibilities of `refresh` is to update potentially-invalid caches of price information. However, if we expect that these external contracts might exhibit truly arbitrary behavior, then it can happen that two Collateral plugins `A` and `B` might cause interactions between the underlying protocols such that calling either `A.refresh` or `B.refresh` will change the state of the protocol underlying both `A` and `B`, such that at least one cache is always out-of-date.

There's no sensible precaution for the protocol to take against this sort of situation. Instead, the RToken protocol guarantees that, for any transaction that depends on some Collateral's price and status, at the point of dependence in the control flow:

- The protocol has called `refresh()` in the same transaction,
- Since any non-Collateral interaction, the protocol has either called `refresh()`

Necessarily, we leave it to the deployers of any further Collateral plugins to ensure that these properties suffice to ensure the safety of any particular RToken deployment.

### Developer discipline

- If an `external` or `public` function makes a non-view call to any contract outside our system, or otherwise calls a function annotated with `@custom:interaction`, the function is an interaction, and MUST be annotated with `@custom:interaction`.
- Every interaction MUST either:
  - follow the CEI pattern,
  - have the `nonReentrant` modifier AND be part of a contract that uses `ReentrancyGuard`, or
  - be listed in [Exceptions](#exceptions) above and contain comments explaining why it's reentrancy-safe.

## Upgrades

Components of production version P1 are designed to be upgradeable using the Proxy Upgrade Pattern, as implemented by OpenZeppelin. More information about this general pattern is available in the [OZ documentation][proxy-docs].

[proxy-docs]: https://docs.openzeppelin.com/upgrades-plugins/1.x/proxies

This implies that the core contracts in P1 (`Main` and core components) are meant to be deployed as implementation contracts, which will serve as a reference to deploy later specific instances (or "proxies") via the `Deployer` contract. If changes are required in the future, a new implementation version can be deployed and the Proxy can be upgrated to point to this new implementation, while preserving its state and storage.

### Writing upgrade-safe contracts

The OpenZeppelin documentation has good material on [how to write upgradable contracts][writing-upgradable].

Prior to initial launch, the most glaring consequence of keeping this upgrade pattern is that core P1 contracts cannot rely on their constructor to initialize values in contract state. Instead, each contract must define a separate initializer function to initialize its state.

[writing-upgradable]: https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable

### Performing upgrades

When upgrading smart contracts it is crucial to keep in mind the limitations of what can be changed/modified to avoid breaking the contracts. As OZ recommends, we use their upgrades plugin for Hardhat to ensure that implementations are upgrade-safe before upgrading any smart contract.

The recommended process to perform an upgrade is the following:

- Create the new implementation version of the contract. This should follow all the recommendations from the article linked above, to make sure the implementation is "Upgrade Safe"

- Ensure metadata of the existing/deployed proxies is created for the required network. This is located in a folder names `.openzeppelin`, which should be persisted in `git` for Production networks. Because the initial proxies are deployed via the `Deployer` factory contract, this folder needs to be created using the [forceImport][] function provided by the plugin. A concrete example on how to use this function is provided in our Upgradeability test file (`test/Upgradeability.test.ts`)

- Using mainnet forking, make sure you perform tests to check the new implementation behaves as expected. Proxies should be updated using the `upgradeProxy` function provided by the plugin to ensure all validations and checks are performed.

- Create a deployemnt script to the required network (Mainnet), using `upgradeProxy`. Ensure the new version of the `.openzeppelin` files are checked into `git` for future reference.

For additional information on how to use the plugins and how to perform upgrades on smart contracts please refer to the [OZ docs][upgrades-docs].

[upgrades-docs]: https://docs.openzeppelin.com/upgrades
[forceimport]: https://docs.openzeppelin/upgrades-plugins/1.x/api-hardhat-upgrades#force-import

### Why it's safe to use multicall on our upgradable contracts

In our P1 implementation both our RevenueTrader and BackingManager components contain `delegatecall`, even though they are themselves implementations that sit behind an ERC1967Proxy (UUPSUpgradeable). This is disallowed by default by OZ's upgradable plugin.

In this case, we think it is acceptable. The special danger of containing a `delegatecall` in a proxy implementation contract is that the `delegatecall` can self-destruct the proxy if the executed code contains `selfdestruct`. In this case `Multicall` executes `delegatecall` on `address(this)`, which resolves to the address of its caller, the proxy. This executes the `fallback` function, which results in another `delegatecall` to the implementation contract. So the only way for a `selfdestruct` to happen is if the implementation contract itself contains a `selfdestruct`, which it does not.

Note that `delegatecall` can also be dangerous for other reasons, such as transferring tokens out of the address in an unintended way. The same argument applies to any such case; only the code from the implementation contract can be called.

### Developer discipline

Here, "contract state" refers to the normal storage variables of a smart contract.

- P1 core contracts MUST NOT contain `immutable` state variables. (P1 core contracts MAY define `constant` values.)
- P1 core contracts MUST NOT set state variables in their constructor.
- P1 core contracts MUST NOT initialize state variables where they are declared.

Instead of any of these, P1 core contracts will probably each define an initializer funcion, per the usual OZ upgradability pattern. A P1 core contract MAY depend on that initializer having run before any other functions.

### Storage Gaps

All our upgradeable contracts (and their base classes) implement storage gaps mimicking the standard OZ practice from `@openzeppelin/contracts-upgradeable`. That is: at the bottom of each of these contracts there is a `uint256[X] private __gap` declaration, where X is set to 50 minus the number of storage slots that the class uses. Remember, constants do not use storage slots, and some data members may pack together!

It's also not absolutely crucial for the gaps to be sized correctly; the practice OZ suggests is to allocate 50 slots to each inheritance class contract, but it's not a big deal if there are a few more or few less (I think).
