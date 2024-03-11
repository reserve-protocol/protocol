# Staked-Frax-ETH Collateral Plugin

## Summary

This plugin allows `sfrxETH` ((Staked-Frax-ETH)[https://docs.frax.finance/frax-ether/overview]) holders use their tokens as collateral in the Reserve Protocol.

`sfrxETH` is a LSD (Liquid staking derivatives) of `ETH` which allows holders to obtain liquid value from their `ETH` while generating yield from it by staking it in the Ethereum POS consensus protocol.

`sfrxETH` will accrue revenue from **staking rewards** into itself by **increasing** the exchange rate of `frxETH` per `sfrxETH`.

You can get the `frxETH/sfrxETH` exchange rate from [`sfrxETH.pricePerShare()`](https://github.com/FraxFinance/frxETH-public/blob/master/src/sfrxETH.sol#L82) method of `sfrxETH` contract.

`sfrxETH` contract: <https://etherscan.io/address/0xac3E018457B222d93114458476f3E3416Abbe38F>

`frxETH` contract: <https://etherscan.io/address/0x5E8422345238F34275888049021821E8E08CAa1f>

## Implementation

### Units

| tok     | ref    | target | UoA |
| ------- | ------ | ------ | --- |
| sfrxETH | frxETH | ETH    | USD |

### Functions

#### refPerTok {ref/tok}

This function returns rate of `frxETH/sfrxETH`, getting from [pricePerShare()](https://github.com/FraxFinance/frxETH-public/blob/master/src/sfrxETH.sol#L82) function in sfrxETH contract.

#### target-per-ref price {tar/ref}

The targetPerRef price of `ETH/frxETH` is received from the frxETH/ETH FRAX-managed oracle ([details here](https://docs.frax.finance/frax-oracle/frax-oracle-overview)).

#### tryPrice

This function uses `refPerTok` and the chainlink price of `USD/ETH` to return the current price range of the collateral. Once an oracle becomes available for `frxETH/ETH`, this function should be modified to use it and return the appropiate `pegPrice`.
