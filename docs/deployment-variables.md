# Deployment Parameters

### `dist` (revenue split)

The fraction of revenues that should go towards RToken holders vs stakers, as given by the relative values of `dist.rTokenDist` and `dist.rsrDist`. This can be thought of as a single variable between 0 and 100% (during deployment).

Default value: 60% to stakers and 40% to RToken holders.
Reasonable range: 0% to 100%

### `minTradeVolume`

Dimension: `{UoA}`

The minimum sized trade that can be performed, in terms of the unit of account.

Setting this too high will result in auctions happening infrequently or the RToken taking a haircut when it cannot be sure it has enough staked RSR to succeed in rebalancing at par.

Setting this too low may allow griefers to delay important auctions. The variable should be set such that donations of size `minTradeVolume` would be worth delaying trading `batchAuctionLength` seconds in the event of urgent recollateralization.

This variable should NOT be interpreted to mean that auction sizes above this value will necessarily clear. It could be the case that gas frictions are so high that auctions launched at this size are not worthy of bids.

This parameter can be set to zero.

Default value: `1e21` = $1k on mainnet; `1e20` = $100 on L2s
Reasonable range: 1e19 to 1e23

#### `rTokenMaxTradeVolume`

Dimension: `{UoA}`

The maximum sized trade for any trade involving RToken, in terms of the unit of account. The high end of the price is applied to this variable to convert it to a token quantity.

This parameter can be set to zero.

Default value: `1e24` = $1m
Reasonable range: 1e22 to 1e27.

### `rewardRatio`

Dimension: `{1}`

The `rewardRatio` is the fraction of the current reward amount that should be handed out per second.

Default value: `1146076687500` = a half life of 7 days

Reasonable range: 1e11 to 1e14

To calculate: `ln(2) / (seconds in half life)`, and then multiply by 1e18.

```
1 week half-life: ln(2) / (7 * 24 * 60 * 60) * 1e18 = 1146076687500
```

### `unstakingDelay`

Dimension: `{seconds}`

The unstaking delay is the number of seconds that all RSR unstakings must be delayed in order to account for stakers trying to frontrun defaults. It must be longer than governance cycle, and must be long enough that RSR stakers do not unstake in advance of foreseeable basket change in order to avoid being expensed for slippage.

Default value: `1209600` = 2 weeks
Reasonable range: 1 to 31536000

### `tradingDelay`

Dimension: `{seconds}`

The trading delay is how many seconds should pass after the basket has been changed before a trade can be opened. In the long term this can be set to 0 after MEV searchers are firmly integrated, but at the start it may be useful to have a delay before trading in order to avoid worst-case prices.

Default value: `0` = 0s
Reasonable range: 0 to 604800

### `warmupPeriod`

Dimension: `{seconds}`

The warmup period is how many seconds should pass after the basket regained the SOUND status before an RToken can be issued and/or a trade can be opened.

Default value: `900` = 15 minutes
Reasonable range: 0 to 604800

### `reweightable`

Dimension: `{bool}`

A reweightable RToken can have its target amounts changed by governance via `forceSetPrimeBasket()`. In general RTokens should be non-reweightable, unless their usecase requires it. The work required to change the target amounts of a reweightable RToken responsibly is non-trivial, and should be done by a spell.

Default value: `false`

### `enableIssuancePremium`

Dimension: `{bool}`

An RToken with issuance premium enabled will increase issuance costs to compensate for any (partial) de-pegs observed in the underlying collateral. This protects RToken holders and RSR stakers from toxic issuance that may occur on the way to a default, or simply when a collateral reliably trades below its peg, such as frxETH.

This also creates an additional revenue stream for the RToken that scales with issuance velocity.

Default value: `true`

### `batchAuctionLength`

Dimension: `{seconds}`

The auction length is how many seconds long Gnosis EasyAuctions should be.

Default value: `900` = 15 minutes
Reasonable range: 60 to 3600

### `dutchAuctionLength`

Dimension: `{seconds}`

The dutch auction length is how many seconds long falling-price dutch auctions should be. A longer period will result in less slippage due to better price granularity, and a shorter period will result in more slippage.

In general, the dutchAuctionLength should be a multiple of the blocktime. This is not enforced at a smart-contract level.

Default value: `1800` = 30 minutes on (12s blocktime) mainnet; `900` = 15 minutes on L2s
Reasonable range: 100 to 3600

### `backingBuffer`

Dimension: `{1}`

The backing buffer is a percentage value that describes how much extra collateral to hold in the BackingManager. This can be important for preventing RSR seizure during normal rebalancing as a result of trading slippage.

However, too large a backing buffer (as a function of the blended collateral yield) can cause RToken and RSR staker yields to become too sensitive to supply changes; new issuance creates a hole that must be filled in before revenue handout can resume, while new redemptions cause the excess capital to be immediately realized as revenue.

If the backing buffer is set too low, it's possible to get into a situation where RSR stakers begin individually unstaking before rebalancing proposals in order to avoid being slashed. The backing buffer should be high enough to prevent this outcome for expected rebalances.

It is not important to consider the backing buffer for _default_ scenarios, only governance-led rebalances.

Default value: `1e15` = 0.1%
Reasonable range: 1e13 to 1e17

### `maxTradeSlippage`

Dimension: `{1}`

The max trade slippage is a percentage value that describes the maximum deviation from oracle prices that any trade can clear at. Oracle prices have ranges of their own; the maximum trade slippage permits additional price movement beyond the worst-case oracle price.

Default value: `0.01e18` = 1% on mainnet; 0.5% on L2s (with liquidity caveats)
Reasonable range: 1e12 to 1e18

### `shortFreeze`

Dimension: `{s}`

The number of seconds a short freeze lasts. Governance can freeze forever.

Default value: `259200` = 3 days
Reasonable range: 3600 to 2592000 (1 hour to 1 month)

### `longFreeze`

Dimension: `{s}`

The number of seconds a long freeze lasts. Long freezes can be disabled by removing all addresses from the `LONG_FREEZER` role. A long freezer has 6 charges that can be used.

Default value: `604800` = 7 days
Reasonable range: 86400 to 31536000 (1 day to 1 year)

### `withdrawalLeak`

Dimension: `{1}`

The fraction of RSR stake that should be permitted to withdraw without a refresh. When cumulative withdrawals (or a single withdrawal) exceed this fraction, gas must be paid to refresh all assets.

Setting this number larger allows unstakers to save more on gas at the cost of allowing more RSR to exit improperly prior to a default.

Default value: `5e16` = 5% on mainnet; 1% on L2s
Reasonable range: 0 to 25e16 (0 to 25%)

### `RToken Supply Throttles`

In order to restrict the system to organic patterns of behavior, we maintain two supply throttles, one for net issuance and one for net redemption. When a supply change occurs, a check is performed to ensure this does not move the supply more than an acceptable range over a period; a period is fixed to be an hour. The acceptable range (per throttle) is a function of the `amtRate` and `pctRate` variables. **It is the maximum of whichever variable provides the larger rate.**

The recommended starting values (amt-rate normalized to $USD) for these parameters are as follows:
|**Parameter**|**USD Value**|
|-------------|---------|
|issuanceThrottle.amtRate|$2m|
|issuanceThrottle.pctRate|10%|
|redemptionThrottle.amtRate|$2.5m|
|redemptionThrottle.pctRate|12.5%|

Be sure to convert a $ amtRate (units of `{qUSD}`) back into RTokens (units of `{qTok}`).

Note the differing units: the `amtRate` variable is in terms of `{qRTok/hour}` while the `pctRate` variable is in terms of `{1/hour}`, i.e a fraction.

**The redemption throttle must be set higher than the issuance throttle.**

#### `issuanceThrottle.amtRate`

Dimension: `{qRTok/hour}`

A quantity of RToken that serves as a lower-bound for how much net issuance to allow per hour.

Must be at least 1 whole RToken, or 1e18. Can be as large as 1e48. Set it to 1e48 if you want to effectively disable the issuance throttle altogether.

Default value: `2e24` = 2,000,000 RToken. If the RToken is not pegged to USD then this number should be discounted by a factor of the RToken price in USD. For example: an ETH-pegged RToken might use `2e24 / 4000` = 500,000 RToken.

Reasonable range: 1e22 to 1e27

#### `issuanceThrottle.pctRate`

Dimension: `{1/hour}`

A fraction of the RToken supply that indicates how much net issuance to allow per hour.

Can be 0 to solely rely on `amtRate`; cannot be above 1e18.

Default value: `10e16` = 10% per hour
Reasonable range: 1e15 to 1e18 (0.1% per hour to 100% per hour)

#### `redemptionThrottle.amtRate`

Dimension: `{qRTok/hour}`

A quantity of RToken that serves as a lower-bound for how much net redemption to allow per hour.

Must be at least 1 whole RToken, or 1e18. Can be as large as 1e48. Set it to 1e48 if you want to effectively disable the redemption throttle altogether.

Default value: `2.5e24` = 2,500,000 RToken. If the RToken is not pegged to USD then this number should be discounted by a factor of the RToken price in USD. For example: an ETH-pegged RToken might use `2.5e24 / 4000` = 625,000 RToken.
Reasonable range: 1e23 to 1e27

#### `redemptionThrottle.pctRate`

Dimension: `{1/hour}`

A fraction of the RToken supply that indicates how much net redemption to allow per hour.

Can be 0 to solely rely on `amtRate`; cannot be above 1e18.

Default value: `12.5e16` = 12.5% per hour
Reasonable range: 1e15 to 1e18 (0.1% per hour to 100% per hour)

### Governance Parameters

Governance is generally 8 days end-to-end.

**Default values**

- Voting delay: 2 day
- Voting period: 3 days
- Execution delay: 3 days

Proposal Threshold: 0.01%
Quorum: 10% of the StRSR supply (not RSR)
