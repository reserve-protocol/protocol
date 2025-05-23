# Anzen USDz Collateral Plugin

## Summary

`USDz` is a stablecoin backed by a diversified portfolio of private credit assets, specifically over-collateralized asset-backed securities. These assets are rigorously underwritten in partnership with Percent, a US licensed broker-dealer that has structured and serviced over $1.7 billion in credit deals since 2018. The protocol deploys capital alongside institutional fiat investors, ensuring a robust and secure backing for USDz.

The diversified credit portfolio underlying USDz provides a consistent income stream that can support sustainable rewards emissions for `sUSDz(Staked USDz)`. This design allows USDz to be a reliable store of value based on its stable RWA backing, with the added benefit of consistent rewards emissions that are uncorrelated to crypto price movements.

`sUSDz` is a high-yield ERC4626 vault, most similar to the DAI savings module. This plugin allows `sUSDz` holders to use their tokens as collateral in the Reserve Protocol.

Since it is ERC4626, the redeemable USDz amount can be obtained by dividing `sUSDz.totalAssets()` by `sUSDz.totalSupply()`.

`USDz` contract: 
    - <https://etherscan.io/address/0xA469B7Ee9ee773642b3e93E842e5D9b5BaA10067#code>
    - <https://basescan.org/address/0x04D5ddf5f3a8939889F11E97f8c4BB48317F1938#code>

`sUSDz` contract:
    - <https://etherscan.io/address/0x547213367cfb08ab418e7b54d7883b2c2aa27fd7#code>
    - <https://basescan.org/address/0xe31ee12bdfdd0573d634124611e85338e2cbf0cf#code>

## Implementation

### Units

| tok   | ref  | target | UoA |
| ----- | ---- | ------ | --- |
| sUSDz | USDz | USD    | USD |

### Functions

#### refPerTok {ref/tok}

`return shiftl_toFix(erc4626.convertToAssets(oneShare), -refDecimals)`