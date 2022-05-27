# Security

## Overview

TODO

## Function Ontology

All system-external functions are classified into one of the following 3 categories:

1. `@custom:interaction` - Action. Disallowed while paused. Per-contract reentrant lock applied.
2. `@custom:governance` - Governance change. Allowed while paused.
3. `@custom:refresher` - Non-system-critical state transitions. Disallowed while paused, with the exception of `refresh`.

All execution flows through the protocol should contain AT MOST a single (1) action or (2) governance change.

Functions that are not system-external, but merely contract-external, are tagged with `@custom:protected`. It is governance's job to ensure a malicious contract is never allowed to masquerade as a component and call one of these. They do not execute when paused.

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
- backingManager.manageTokens()
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

## Specific areas of concern

### Multicall: delegateCall from proxy implementation

In our P1 implementation both our RevenueTrader and BackingManager components contain `delegatecall`, even though they are themselves implementations that sit behind an ERC1967Proxy (UUPSUpgradeable). This is disallowed by default by OZ. 

In this case, we think it is acceptable. The special danger of containing a `delegatecall` in a proxy implementation contract is that the `delegatecall` can self-destruct the proxy if the executed code contains `selfdestruct`. In this case `Multicall` executes `delegatecall` on `address(this)`, which resolves to the address of its caller, the proxy. This executes the `fallback` function, which results in another `delegatecall` to the implementation contract. So the only way for a `selfdestruct` to happen is if the implementation contract itself contains a `selfdestruct`, which it does not.

Note that `delegatecall` can also be dangerous for other reasons, such as transferring tokens out of the address in an unintended way. The same argument applies to any such case; only the code from the implementation contract can be called.

### Reentrancy Problems

This is, unavoidably, an entire developer discipline. See [handling reentrancy](handling-reentrancy.md) in our docs.
