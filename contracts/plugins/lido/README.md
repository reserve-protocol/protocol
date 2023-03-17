# Lido stETH Collateral Plugin

## Summary

This plugin allows `wstETH` holders use their tokens as collateral in the Reverse Protocol.

As described in the [Lido Site](https://docs.lido.fi/guides/steth-integration-guide#wsteth) , `wstETH` is a LSD (Liquid staking derivatives) which enables users to sell or transfer stacked ETH even before withdrawal being enabled.

`wstETH` will accrue revenue from **staking rewards** into itself by **increasing** the exchange rate of `stETH` per `wstETH`.

You can get exchange rate from [`wstETH.stEthPerToken()`](https://etherscan.io/token/0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0#readContract#F10) method of wstETH contract.

`wstETH` contract: <https://etherscan.io/token/0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0#code>

`stETH` contract: <https://etherscan.io/token/0xae7ab96520de3a18e5e111b5eaab095312d7fe84#code>

As described on `stETH Intro`, `stETH` is a rebasing token which means token balances is not fixed. Due to that, it can not be used directly as collateral the Reverse Protocol. The solution for that is using `wstETH` instead which is not a rebasing token and behaves like `rETH` and `cbETH`.

`wstETH` and `stETH` can be always swapped at any time to each other without any risk and limitation (Except smart contract risk), like `wETH` and `ETH`. Wrap & Unwrap app can be found here: <https://stake.lido.fi/wrap>

## Implementation

### Units

| tok    | ref   | target | UoA |
| ------ | ----- | ------ | --- |
| wstETH | stETH | ETH    | USD |

### Functions

#### refPerTok {ref/tok}

This function returns rate of `stETH/wstETH`, getting from [stEthPerToken()](https://etherscan.io/token/0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0#readContract#F10) function in wstETH contract.
