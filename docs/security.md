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

In our P1 implementation both our RevenueTrader and BackingManager components contain `delegatecall`, even though they are themselves implementations that sit behind an ERC1967Proxy (UUPSUpgradeable). This is disallowed by default by OZ. Below is the argument why we think in this case it is acceptable:

> The danger of containing a `delegatecall` in the code of a proxy implementation contract (among others) is that the `delegatecall` can self-destruct the proxy if the executed code contains `selfdestruct`. In this case `Multicall` executes `delegatecall` on `address(this)`, which resolves to the address of the caller contract, ie the proxy. This causes the `fallback` function to execute, which results in another `delegatecall` to the implementation contract. So we are left in a situation where the only way for a `selfdestruct` to happen is if the implementation contract itself contains a `selfdestruct`, which it does not.

Note that `delegatecall` can also be dangerous for other reasons, such as transferring tokens out of the address in an unintended way. A similar argument applies in that case. It again reduces to the code contained in the implementation contract.

### Reentrancy Problems

Since universal and consistent usage of the [Check-Effects-Interactions](https://docs.soliditylang.org/en/develop/security-considerations.html#use-the-checks-effects-interactions-pattern) pattern is not practical for a system whose behavior critically depends on the current state of external contracts when that state can only be read through non-view functions, we need to use a system of reentrancy guards.

Moreover, the per-contract reentrancy guard mechanism provided by OpenZepplin does not work cleanly for our multi-contract system, because it leaves open the possibility that an attacker will launch a full-system reentrancy attack. A schematic example might look like:

- A and B are system contracts; E is an external contract.
- A.foo() is a user-callable function that depends on the state of B
- A.foo() typically calls E.baz()
- B.bar() is a user-callable function that changes the state of B

A potential attack runs as follows:

1. Eve subverts contract E so that E.baz() calls B.bar()
2. Eve calls A.foo(), which calls E.baz(), which calls B.bar()
3. B.bar() changes B's state in a way that violates A.foo()'s expectations
4.

Main's security domain is Main plus the Components. Collateral and Trade contracts are not considered within the security domain.
