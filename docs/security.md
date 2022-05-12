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
