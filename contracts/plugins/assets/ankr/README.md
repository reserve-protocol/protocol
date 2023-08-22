# Ankr ETH Collateral Plugin

**NOTE: The AnkrStakedEthCollateral plugin SHOULD NOT be deployed and used until a `ankrETH/ETH` chainlink oracle can be integrated with the plugin. As of 3/14/23, there is no chainlink oracle, but the ANKR team is working on getting one.**

## Summary

This plugin allows the usage of [ankrETH](https://www.ankr.com/about-staking/) as a collateral for the Reserve Protocol.

The `ankrETH` token represents the users staked ETH plus accumulated staking rewards. It is immediately liquid, which enables users to trade them instantly, or unstake them to redeem the original underlying asset.

User's balances in `ankrETH` remain constant, but the value of each ankrETH token grows over time. It is a reward-bearing token, meaning that the fair value of 1 ankrETH token vs. ETH2 increases over time as staking rewards accumulate. When possible, users will have the option to redeem ankrETH and unstake ETH2 for ETH with accumulated [staking rewards](https://www.ankr.com/docs/staking/liquid-staking/eth/overview/).

## Implementation

### Units

| tok     | ref  | target | UoA |
| ------- | ---- | ------ | --- |
| ankrETH | ETH2 | ETH    | USD |

### Functions

#### refPerTok {ref/tok}

The exchange rate between ETH2 and ankrETH can be fetched using the ankrETH contract function `ratio()`. From this, we can obtain the inverse rate from ankrETH to ETH2, and use that as `refPerTok`.

This new ratio, increases over time, which means that the amount of ETH redeemable for each ankrETH token always increases, though redemptions sit behind a withdrawal queue.

`ratio()` returns the exchange rate in 18 decimals.
