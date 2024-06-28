# Ethena USDe Collateral Plugin

## Summary

`USDe` is a synthetic dollar protocol built on Ethereum that derives its value from a delta-neutral basis trade based on funding rates: long ETH-LSD + short ETH. This combined position captures the funding rate on perpetual exchanges, which has been historically positive throughout crypto’s history, which is also used to provision an additional `sUSDe` token.

This plugin allows `sUSDe` holders to use their tokens as collateral in the Reserve Protocol.

`sUSDe` is a high-yield (today) ERC4626 vault, most similar to the DAI savings module. The redeemable USDe amount can be obtained by dividing `sUSDe.totalAssets()` by `sUSDe.totalSupply()`.

`USDe` contract: <https://etherscan.io/address/0x4c9edd5852cd905f086c759e8383e09bff1e68b3#code>

`sUSDe` contract: <https://etherscan.io/address/0x9D39A5DE30e57443BfF2A8307A4256c8797A3497#code>

## Implementation

### Units

| tok   | ref  | target | UoA |
| ----- | ---- | ------ | --- |
| sUSDe | USDe | USD    | USD |

### Functions

#### refPerTok {ref/tok}

`return shiftl_toFix(erc4626.convertToAssets(oneShare), -refDecimals)`
