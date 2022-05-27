# Reentrancy-Safety Policy

## Marking interactions

Some functions in our system are classed as interactions. In the natSpec comments, they're marked with the @custom:interaction annotation, both on their implementation and their interface.

A function must be classed as an interaction if it:

- Makes a non-view call to any contract outside our system, or
- Calls a function classed as an interaction

## Structuring interactions

As matters of policy, here are the three generic options for structuring interactions so that they're reentrancy-safe:

### CEI pattern

Per the Checks-Effects-Interactions pattern, all interactions called by a function in our system must occur after any other:

- view calls to other contracts,
- writes to storage, or
- reads from storage,

... except that any interaction that relies on up-to-date collateral prices, or which needs to fail in the face of current-basket default, should call `AssetRegistry.refresh()` before reading or writing its own storage.

Roughly, this is exception is safe because we're doing this interaction before any state reading in the function; so the rest of the function is still operating from a consistent view of the world --- it's just the view from after a particular interaction instead of the view from before all interactions.

At the start of the Interactions block in a CEI-pattern function, set them off visually with a comment like: `// == Interactions ==`

When a function is an interaction made reentrancy-safe by the CEI pattern, follow its `@custom:interaction` mark with `CEI`, or with `RCEI` (R is for "Refresh") if it starts by calling `AssetRegistry.refresh()`.

### ReentrancyGuard

Where using the CEI pattern is impractical, every function on that contract that is `external`, and can write to the relevant state elements, should use `reentrancyGuard`. That is, the contract should inherit from either `ReentrancyGuard` (or `ReentrancyGuardUpgradable` as needed), and every external function that can either modify contract state, or read it when it's inconsistent, should be marked with the `nonReentrant` modifier.

### Exceptions

Anything that doesn't fit these two policies precisely must be carefully and fully documented inline, and added to this list:

- In `CTokenFiatCollateral`, `refresh()` follows the same general pattern as other contracts themselves using `AssetRegistry.refresh()`, and for the same reason; the initial refresher on the CToken contract ensures that prices are updated on the external contract, so that `refPerTok` can later access up-to-date values. This is safe by similar reasoning. (Alternately, if that reasoning is flawed, the same structure is probably a problem here!)

- `RToken.issue()` is almost but not quite in the CEI pattern; it treats `refundSpan` as something like a refresher, and is careful to reread any state necessary to achieve a consistent contract view afterwards.

- `RewardableLib.claimAndSweepRewards()`

- The entire `GnosisTrade` contract is using the moral equivalent of `ReentrancyGuard` to ensure its own reentrancy-safety, but since it's also using the state machine pattern, it can do both with the same state varible and save gas on SLOADs and SSTOREs.

## Reentrancy Risk from Collateral

For some collateral, we can only trust that we have up-to-date prices after we've called `refresh()` on that Collateral contract, during the same transaction. These functions can modify the state of external contracts, so in the usual security model in which we reason about reentrancy, they are potential vectors for reentrancy attacks.

Part of the responsibilities of `refresh` is to update potentially-invalid caches of price information. However, if we expect that these external contracts might exhibit truly arbitrary behavior, then it can happen that two Collateral plugins `A` and `B` might cause interactions between the underlying protocols such that calling either `A.refresh` or `B.refresh` will change the state of the protocol underlying both `A` and `B`, such that at least one cache is always out-of-date.

There's no sensible precaution for the protocol to take against this sort of situation. Instead, the RToken protocol guarantees that, for any transaction that depends on some Collateral's price and status, at the point of dependence in the control flow:

- The protocol has called `refresh()` in the same transaction,
- Since any non-Collateral interaction, the protocol has either called `refresh()`

Necessarily, we leave it to the deployers of any further Collateral plugins to ensure that these properties suffice to ensure the safety of any particular RToken deployment.
