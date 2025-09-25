# Pirex apxETH (pxETH) Collateral Plugin

## Summary

This plugin allows `apxETH` holders use their tokens as collateral in the Reserve Protocol.

As described in the [Dinero Site](https://dineroismoney.com/docs/pirex-eth-overview), Pirex ETH is an Ethereum liquid staking solution that consists of two tokens, `pxETH` and `apxETH`.

Upon depositing ETH into the Dinero protocol through Pirex ETH, users receive `pxETH` - a liquid wrapper for staked ETH. However, the pxETH token itself does not earn any rewards. Users can deposit to Dinero's auto-compounding vaults to obtain `apxETH`, which is focused on maximizing their staking yields. Each `apxETH` benefits from staking rewards from more than one staked ETH, amplifying the yield for apxETH users.

`apxETH` will accrue revenue from **staking rewards** into itself by **increasing** the exchange rate of `pxETH` per `apxETH`.

`pxETH` contract: <https://etherscan.io/address/0x04C154b66CB340F3Ae24111CC767e0184Ed00Cc6#code>

`apxETH` contract: <https://etherscan.io/address/0x9Ba021B0a9b958B5E75cE9f6dff97C7eE52cb3E6#code>

## Implementation

### Units

| tok    | ref   | target | UoA |
| ------ | ----- | ------ | --- |
| apxETH | pxETH | ETH    | USD |

### Functions

#### refPerTok {ref/tok}

This function returns rate of `pxETH/apxETH`, getting from [assetsPerShare()](https://etherscan.io/token/0x9Ba021B0a9b958B5E75cE9f6dff97C7eE52cb3E6#readContract) function in wstETH contract.
