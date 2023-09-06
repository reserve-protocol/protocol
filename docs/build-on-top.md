# Building on Top of Reserve

TODO -- this document is a work in progress.

## Overview

Reserve uses a long-lived Tenderly fork as the main testing environment. Since the Reserve Protocol is a meta-protocol it relies on functional building blocks that are not all present on testnets such as Goerli or Sepolia. For this reason it makes the most sense to use a fork of mainnet.

Unfortunately it would be bad practice to share the RPC publicly. Please reach out at protocol.eng@reserve.org to request we share the RPC privately with you.

## Chain

We re-use the chain ID of 3 (previously: ropsten) for the Tenderly fork in order to separate book-keeping between mainnet and the fork environment.

- [Core Contracts](../scripts/addresses/3-tmp-deployments.json)
- [Collateral Plugins](../scripts/addresses/3-tmp-assets-collateral.json)
  - Note that oracles require special logic in order to be refreshed and for these plugins to function correctly.
