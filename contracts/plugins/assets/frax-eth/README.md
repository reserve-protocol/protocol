# Staked-Frax-ETH Collateral Plugin

**NOTE: The SFraxEthCollateral plugin SHOULD NOT be deployed and used until a `frxETH/ETH` chainlink oracle can be integrated with the plugin. As of 3/14/23, there is no chainlink oracle, but the FRAX team is working on getting one.**

## Summary

This plugin allows `sfrxETH` ((Staked-Frax-ETH)[https://docs.frax.finance/frax-ether/overview]) holders use their tokens as collateral in the Reserve Protocol.

`sfrxETH` is a LSD (Liquid staking derivatives) of `ETH` which allows holders to obtain liquid value from their `ETH` while generating yield from it by staking it in the Ethereum POS consensus protocol.

`sfrxETH` will accrue revenue from **staking rewards** into itself by **increasing** the exchange rate of `frxETH` per `sfrxETH`.

You can get the `frxETH/sfrxETH` exchange rate from [`sfrxETH.pricePerShare()`](https://github.com/FraxFinance/frxETH-public/blob/master/src/sfrxETH.sol#L82) method of `sfrxETH` contract.

`sfrxETH` contract: <https://etherscan.io/address/0xac3E018457B222d93114458476f3E3416Abbe38F>

`frxETH` contract: <https://etherscan.io/address/0x5E8422345238F34275888049021821E8E08CAa1f>

`wstETH` and `stETH` can be always swapped at any time to each other without any risk and limitation (Except smart contract risk), like `wETH` and `ETH`. Wrap & Unwrap app can be found here: <https://stake.lido.fi/wrap>

## Implementation

### Units

| tok     | ref    | target | UoA |
| ------- | ------ | ------ | --- |
| sfrxETH | frxETH | ETH    | USD |

### Functions

#### refPerTok {ref/tok}

This function returns rate of `frxETH/sfrxETH`, getting from [pricePerShare()](https://github.com/FraxFinance/frxETH-public/blob/master/src/sfrxETH.sol#L82) function in sfrxETH contract.

#### tryPrice

This function uses `refPerTok`, the chainlink price of `ETH/frxETH`, and the chainlink price of `USD/ETH` to return the current price range of the collateral.
