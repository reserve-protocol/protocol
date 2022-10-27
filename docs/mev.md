# MEV

This document is intended to serve as a resource for MEV searchers and others looking to interact with the deployed protocol programatically.

## Overview

TODO

## FacadeAct

The contract [contracts/facade/FacadeAct.sol](contracts/facade/FacadeAct.sol) provides a single calldata preparation function `getActCalldata(...)` that should be executed via [ethers.callStatic](https://docs.ethers.io/v5/api/contract/contract/#contract-callStatic).

```
function getActCalldata(RTokenP1 rToken) external returns (address to, bytes memory calldata_);
```

If the zero address is returned, then no action needs to be taken on the RToken instance at the moment.

If a nonzero address is returned, then the bot/caller can sign a tx addressed to the address returned, with the data bytes from the second return value. This may be a call such as:

- `rToken.main().furnace().melt()`
- `rToken.main().backingManager().manageTokens([...])`
- `rToken.main().rTokenTrader().manageToken(...)`
- `rToken.main().rsrTrader().manageToken(...)`
- `rToken.main().stRSR().payoutRewards()`
- etc

You'll definitely want to simulate the tx first though, to understand the gas cost and decide whether you actually want to execute it.
