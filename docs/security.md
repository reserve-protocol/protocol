# Security

## Overview

TODO

## Specific areas of concern

### Multicall: delegateCall from proxy implementation

In our P1 implementation both our RevenueTrader and BackingManager components contain `delegatecall`, even though they are themselves implementations that sit behind an ERC1967Proxy (UUPSUpgradeable). This is disallowed by default by OZ. Below is the argument why we think in this case it is acceptable:

```
    The danger of containing a `delegatecall` in the code of a proxy implementation contract (among others) is that the `delegatecall` can self-destruct the proxy if the executed code contains `selfdestruct`. In this case `Multicall` executes `delegatecall` on `address(this)`, which resolves to the address of the caller contract, ie the proxy. This causes the `fallback` function to execute, which results in another `delegatecall` to the implementation contract. So we are left in a situation where the only way for a `selfdestruct` to happen is if the implementation contract itself contains a `selfdestruct`, which it does not.
```

Note that `delegatecall` can also be dangerous for other reasons, such as transferring tokens out of the address in an unintended way. A similar argument applies in that case. It again reduces to the code contained in the implementation contract.

### Reentrancy

#### Problem classification

Definition: Main's security domain is Main plus the Components. Collateral and Trade contracts are not considered within the security domain.

```
1. Reentrancies that terminate within main's security domain
2. Reentrancies that terminate outside main's security domain
    A. In a trading platform (e.g Gnosis)
    B. In a defi protocol (e.g Compound)
    C. In a registered ERC20 token contract
```

#### Solution

Reentrancies of type (1) do not require a fix, because if a malicious contract is inside our security domain then we have other problems.

For reentrancies of type (2), we have placed `nonReentrant` modifiers at all external functions that contain necessary reentrancy risk. Since `forceUpdates` _must_ exist at the top of many of our external functions, and `CTokenFiatCollateral` poses a system-level risk of type (2B), this means _most_ of our external functions contain the `nonReentrant` modifier.

Contracts not within main's security domain (Collateral, Trade) do not contain `nonReentrant` modifiers because they cannot be considered trusted in the first place. We do not want to push a correctness constraint out to governance if we can.
