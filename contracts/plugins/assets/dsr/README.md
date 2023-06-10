# SDAI DSR Collateral Plugin

## Summary

This plugin allows `sDAI` holders to use their tokens as collateral in the Reserve Protocol.

sDAI is an unowned, immutable, ERC4626-wrapper around the Dai savings rate.

`sDAI` will accrue the same amount of DAI as it would if it were deposited directly into the DSR.

Since it is ERC4626, the redeemable DAI amount can be gotten by dividing `sDAI.totalAssets()` by `sDAI.totalSupply()`. However, the same rate can be read out more directly by calling `pot.chi()`, for the MakerDAO pot. There is a mutation required before either of these values can be read.

`sDAI` contract: <https://etherscan.io/token/https://etherscan.io/address/0x83f20f44975d03b1b09e64809b757c47f942beea#code>

## Implementation

### Units

| tok  | ref | target | UoA |
| ---- | --- | ------ | --- |
| sDAI | DAI | USD    | USD |

### Functions

#### refPerTok {ref/tok}

`return shiftl_toFix(pot.chi(), -27);`
