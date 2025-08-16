# Tokemak Autopool Collateral Plugin

## Summary

These plugins allow Tokemak Autopilot users, ie holders of `autoETH` or `autoUSD`, to use their tokens as collateral in the Reserve Protocol.

[Tokemak Autopilot](https://docs.tokemak.xyz/autopilot/autopilot-tl-dr) is an automated liquidity aggregator, which seeks out the optimum yield for non-volatile blue-chip liquidity pools, compounds rewards, and rebalances to maintain the optimum allocation. What DEX aggregators did for traders, Autopilot does for LPs.

`autoETH` earns the **liquidity rate** for ETH LSTs. `autoUSD` earns the **liquidity rate** for USD-stablecoins.

`autoETH` contract: <https://etherscan.io/address/0x0A2b94F6871c1D7A32Fe58E1ab5e6deA2f114E56#code>

`autoUSD` contract: <https://etherscan.io/address/0xa7569a44f348d3d70d8ad5889e50f78e33d80d35#code>

## Implementation

### Units

| tok     | ref   | target | UoA |
| ------  | ----- | ------ | --- |
| autoETH | WETH  | ETH    | USD |
| autoUSD | USDC  | USD    | USD |
