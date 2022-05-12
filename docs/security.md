# Security

## Overview

TODO

## Function Ontology

Contract-external functions can be classified into the following 3 types:

1. `@custom:action` - Action. Disallowed while paused.
2. `@custom:governance` - Governance change. Allowed while paused.
3. `@custom:subroutine` - Can only be called by Components. Allowed while paused.

All execution flows through the protocol should contain AT MOST a single (1) action or (2) governance change. This is enforced via a global lock that is acquired at the start of function execution.

Functions of type (1) or (2) may call functions of type (3), but not the other way around.

There is nothing prohibiting functions of type (3) from calling functions of type (3), but it should not happen due to the way the contract architecture is structured.

Subroutines (3) cannot be called from outside the system. In situations where they must be exposed, we create an additional action (1) function for that purpose, and suffix the subroutine version with "\_sub".

### `@custom:action`

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

The below functions exist as BOTH actions AND subroutines.

Subroutine duplicates:

- furnace.melt()
- stRSR.payoutRewards()
- assetRegistry.forceUpdates()
- basketHandler.checkBasket()

### `@custom:governance`

- set\*()
  ...there are many and they are not worth naming individually

Governance functions acquire a lock at the beginning of execution, and can be executed while paused. They may call subroutines.

### `@custom:subroutine`

These cannot be called from outside the system and do not require the system to be unpaused.

- broker.openTrade()
- furnace.melt_sub()
- stRSR.payoutRewards_sub()
- assetRegistry.forceUpdates_sub()
- basketHandler.checkBasket_sub()

## Specific areas of concern

### Multicall: delegateCall from proxy implementation

In our P1 implementation both our RevenueTrader and BackingManager components contain `delegatecall`, even though they are themselves implementations that sit behind an ERC1967Proxy (UUPSUpgradeable). This is disallowed by default by OZ. Below is the argument why we think in this case it is acceptable:

```
    The danger of containing a `delegatecall` in the code of a proxy implementation contract (among others) is that the `delegatecall` can self-destruct the proxy if the executed code contains `selfdestruct`. In this case `Multicall` executes `delegatecall` on `address(this)`, which resolves to the address of the caller contract, ie the proxy. This causes the `fallback` function to execute, which results in another `delegatecall` to the implementation contract. So we are left in a situation where the only way for a `selfdestruct` to happen is if the implementation contract itself contains a `selfdestruct`, which it does not.
```

Note that `delegatecall` can also be dangerous for other reasons, such as transferring tokens out of the address in an unintended way. A similar argument applies in that case. It again reduces to the code contained in the implementation contract.
