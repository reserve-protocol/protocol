# Ether.fi weETH Collateral Plugin

## Summary

This plugin allows `weETH` holders to use their tokens as collateral in the Reserve Protocol.

As described in the [Ether.fi Documentation](https://etherfi.gitbook.io/etherfi), Ether.fi is a decentralized, non-custodial liquid restaking protocol that consists of two tokens: `eETH` and `weETH`.

Upon depositing ETH into the Ether.fi protocol, users receive `eETH` - a rebasing liquid staking token that earns staking and restaking rewards. The eETH token automatically rebases to reflect accrued rewards. Users can wrap their eETH into `weETH` (wrapped eETH), which is a non-rebasing token suitable for use in DeFi protocols and as collateral.

`weETH` accrues revenue from **staking and restaking rewards** by **increasing** the exchange rate of `eETH` per `weETH`. This exchange rate grows over time as the Ether.fi protocol's validators earn consensus layer rewards and participate in restaking through EigenLayer.

`eETH` contract: <https://etherscan.io/address/0x35fA164735182de50811E8e2E824cFb9B6118ac2>

`weETH` contract: <https://etherscan.io/address/0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee>

## Implementation

### Units

| tok   | ref  | target | UoA |
| ----- | ---- | ------ | --- |
| weETH | eETH | ETH    | USD |

### Functions

#### refPerTok {ref/tok}

This function returns the rate of `eETH/weETH`, obtained from the [getRate()](https://etherscan.io/address/0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee#readProxyContract) function in the weETH contract.
