# Collateral Plugin - Rocket - RETH

## Summary

This plugin allows RTokens to utilize `rETH` [(Rocket-Pool ETH)](https://github.com/rocket-pool/rocketpool/blob/master/contracts/contract/token/RocketTokenRETH.sol)
as collateral. `rETH` is an ERC20, ETH-liquid-staking-token that allows any user to contribute to the security of the
Ethereum network by depositing their ETH in exchange for a liquide and (future) redeemable token representing their
stake in the POS ETH2.0 consenus layer.

[Rocket Pool Docs](https://docs.rocketpool.net/overview/)

`rETH` contract: <https://etherscan.io/address/0xae78736Cd615f374D3085123A210448E74Fc6393>

## Implementation

### Units

| tok  | ref  | target | UoA |
| ---- | ---- | ------ | --- |
| rETH | ETH2 | ETH    | USD |

### refPerTok()

Gets the exchange rate for `rETH` to `ETH2` from the rETH token contract using the [getExchangeRate()](https://github.com/rocket-pool/rocketpool/blob/master/contracts/contract/token/RocketTokenRETH.sol#L66)
function. This is the rate used by rocket pool when converting between reth and eth2 and is closely followed by secondary markets.
While the value of ETH2/rETH **should** be only-increasing, it is possible that slashing or inactivity events could occur for the rETH
validators. As such, `rETH` inherits `AppreciatingFiatCollateral` to allow for some amount of revenue-hiding. The amount of
revenue-hiding should be determined by the deployer, but can likely be quite high, as it is more likely that any dips, however large,
would be temporary, and, in particularly bad instances, be covered by the Rocket Pool protocol.

### claimRewards()

There are no rewards to claim from rETH.
