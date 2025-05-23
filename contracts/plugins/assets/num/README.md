# Collateral Plugins for nARS and snARS

## Summary

This plugin allows `nARS` and `snARS` holders to use their tokens as collateral in the Reserve Protocol.

As described in the [Num Site](https://new.num.finance/) nTokens are ERC20 tokens, tracking the value of an underlying financial asset.
Each nToken issued by Num Finance is fully collateralized by an asset in the traditional market. This means that for every nToken in circulation, there is a real-world asset backing it, ensuring the token's value and stability.

In this particular case we're incorporating through this plugin 2 nTokens.

- `nARS` is a stablecoin pegged to the `Argentine Peso (ARS)`.
- `snARS` is the staked version of `nARS`. When users stake their `nARS`, they receive `snARS` in return, which grants them certain benefits in the form of yield or Numun Rewards.

Staking of `nARS` is possible at: https://numun.fi/
Official num website: https://num.finance/
nStables documentation: https://docs.nstables.fi/

## Implementation

### Units

| tok  | ref | target | UoA |
| ---- | --- | ------ | --- |
| nARS | ARS | ARS    | USD |

| tok   | ref  | target | UoA |
| ----- | ---- | ------ | --- |
| sNARS | nARS | ARS    | USD |

### claimRewards()

There are no rewards to claim
