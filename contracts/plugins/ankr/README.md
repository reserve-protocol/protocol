# Ankr ETH Collateral Plugin

## Summary

This plugin allows the usage of [ankrETH](https://www.ankr.com/about-staking/) as a collateral for the Reserve Protocol.

The `ankrETH` token represents the users staked ETH plus accumulated staking rewards. It is immediately liquid, which enables users to trade them instantly, or unstake them to redeem the original underlying asset.

User's balances in `ankrETH` remain constant, but the value of each ankrETH token grows over time. It is a reward-bearing token, meaning that the fair value of 1 ankrETH token vs. ETH increases over time as staking rewards accumulate. When possible, users will have the option to redeem ankrETH and unstake ETH with accumulated [staking rewards](https://www.ankr.com/docs/staking/liquid-staking/eth/overview/).

## Implementation

### Units

| tok     | ref | target | UoA |
| ------- | --- | ------ | --- |
| ankrETH | ETH | ETH    | USD |

### Functions

#### refPerTok {ref/tok}

The exchange rate between ETH and ankrETH can be fetched using the ankrETH contract function `ratio()`. From this, we can obtain the inverse rate from ankrETH to ETH, and use that as `refPerTok`.

This new ratio, increases over time, which means that the amount of ETH redeemable for each ankrETH token always increases.

`ratio()` returns the exchange rate in 10\*\*18.
