# Angle Staked USDA (stUSD) Collateral Plugin

## Summary

`USDA` is a stablecoin pegged to the dollar built by [Angle Labs](https://github.com/AngleProtocol). `USDA` holders can stake their stablecoins for `stUSD` in order to earn a native yield.

This plugin allows `stUSD` holders to use their tokens as collateral in the Reserve Protocol.

`stUSD` is an ERC4626 vault, most similar to the DAI savings module. The redeemable `USDA` amount can be obtained by dividing `stUSD.totalAssets()` by `stUSD.totalSupply()`.

`USDA` contract: <https://etherscan.io/address/0x0000206329b97DB379d5E1Bf586BbDB969C63274#code>

`stUSD` contract: <https://etherscan.io/address/0x0022228a2cc5E7eF0274A7Baa600d44da5aB5776#code>

## Implementation

### Units

| tok   | ref  | target | UoA |
| ----- | ---- | ------ | --- |
| stUSD | USDA | USD    | USD |