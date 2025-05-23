# SUSDS SSR Collateral Plugin

## Summary

This plugin allows `sUSDS` (Sky) holders to use their tokens as collateral in the Reserve Protocol.

`sUSDS` token represents a tokenized implementation of the Sky Savings Rate for `USDS`, fully compliant with the ERC-4626 standard. It enables real-time share-to-asset conversions, ensuring accurate values even if the system's drip function hasn't been called recently.

These `sUSDS` tokens serve as a digital record of any value accrued to a specific position. The Sky Protocol dynamically and automatically adds USDS tokens to the entire pool of USDS supplied to the module every few seconds, in accordance with the Sky Savings Rate. As a result of the tokens auto-accumulating in the pool over time, the value tends to accrue within the sUSDS being held.

Since it is ERC4626, the redeemable USDS amount can be gotten by dividing `sUSDS.totalAssets()` by `sUSDS.totalSupply()`.
`sUSDS` contract: <https://etherscan.io/address/0xdC035D45d973E3EC169d2276DDab16f1e407384F#code>

Sky Money: https://sky.money/

## Implementation

### Units

| tok   | ref  | target | UoA |
| ----- | ---- | ------ | --- |
| sUSDS | USDS | USD    | USD |

### Functions

#### refPerTok {ref/tok}

`return shiftl_toFix(IERC4626(address(erc20)).convertToAssets(oneShare), -refDecimals, FLOOR);`
