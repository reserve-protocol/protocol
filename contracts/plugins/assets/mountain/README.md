# Mountain USDM Collateral Plugin

## Summary

This plugin allows `wUSDM` holders to use their tokens as collateral in the Reserve Protocol.

`wUSDM` is an unowned, immutable, ERC4626-wrapper around the USDM token.

Since it is ERC4626, the redeemable USDM amount can be obtained by dividing `wUSDM.totalAssets()` by `wUSDM.totalSupply()`.

`USDM` contract: <https://etherscan.io/address/0x59d9356e565ab3a36dd77763fc0d87feaf85508c#code>

`wUSDM` contract: <https://etherscan.io/address/0x57f5e098cad7a3d1eed53991d4d66c45c9af7812#code>

## Implementation

### Units

| tok   | ref  | target | UoA |
| ----- | ---- | ------ | --- |
| wUSDM | USDM | USD    | USD |

### Functions

#### refPerTok {ref/tok}

`return shiftl_toFix(erc4626.convertToAssets(oneShare), -refDecimals)`
