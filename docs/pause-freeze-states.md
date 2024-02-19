# Pause Freeze States

Some protocol functions may be halted while the protocol is either (i) issuance-paused; (ii) trading-paused; or (iii) frozen. Below is a table that shows which protocol interactions (`@custom:interaction`) and refreshers (`@custom:refresher`) execute during paused/frozen states, as of the 3.1.0 release.

All governance functions (`@custom:governance`) remain enabled during all paused/frozen states. They are not mentioned here.

A :heavy_check_mark: indicates the function still executes in this state.
A :x: indicates it reverts.

| Function                                | Issuance-Paused    | Trading-Paused          | Frozen                  |
| --------------------------------------- | ------------------ | ----------------------- | ----------------------- |
| `BackingManager.claimRewards()`         | :heavy_check_mark: | :x:                     | :x:                     |
| `BackingManager.claimRewardsSingle()`   | :heavy_check_mark: | :x:                     | :x:                     |
| `BackingManager.grantRTokenAllowance()` | :heavy_check_mark: | :heavy_check_mark:      | :x:                     |
| `BackingManager.forwardRevenue()`       | :heavy_check_mark: | :x:                     | :x:                     |
| `BackingManager.rebalance()`            | :heavy_check_mark: | :x:                     | :x:                     |
| `BackingManager.settleTrade()`          | :heavy_check_mark: | :heavy_check_mark:      | :heavy_check_mark:      |
| `BasketHandler.refreshBasket()`         | :heavy_check_mark: | :x: (unless governance) | :x: (unless governance) |
| `Broker.openTrade()`                    | :heavy_check_mark: | :heavy_check_mark:      | :heavy_check_mark:      |
| `Broker.reportViolation()`              | :heavy_check_mark: | :heavy_check_mark:      | :heavy_check_mark:      |
| `Distributor.distribute()`              | :heavy_check_mark: | :heavy_check_mark:      | :heavy_check_mark:      |
| `Furnace.melt()`                        | :heavy_check_mark: | :heavy_check_mark:      | :heavy_check_mark:      |
| `Main.poke()`                           | :heavy_check_mark: | :heavy_check_mark:      | :heavy_check_mark:      |
| `RevenueTrader.claimRewards()`          | :heavy_check_mark: | :x:                     | :x:                     |
| `RevenueTrader.claimRewardsSingle()`    | :heavy_check_mark: | :x:                     | :x:                     |
| `RevenueTrader.distributeTokenToBuy()`  | :heavy_check_mark: | :x:                     | :x:                     |
| `RevenueTrader.manageTokens()`          | :heavy_check_mark: | :x:                     | :x:                     |
| `RevenueTrader.returnTokens()`          | :heavy_check_mark: | :x:                     | :x:                     |
| `RevenueTrader.settleTrade()`           | :heavy_check_mark: | :heavy_check_mark:      | :heavy_check_mark:      |
| `RToken.issue()`                        | :x:                | :heavy_check_mark:      | :x:                     |
| `RToken.issueTo()`                      | :x:                | :heavy_check_mark:      | :x:                     |
| `RToken.redeem()`                       | :heavy_check_mark: | :heavy_check_mark:      | :x:                     |
| `RToken.redeemTo()`                     | :heavy_check_mark: | :heavy_check_mark:      | :x:                     |
| `RToken.redeemCustom()`                 | :heavy_check_mark: | :heavy_check_mark:      | :x:                     |
| `StRSR.cancelUnstake()`                 | :heavy_check_mark: | :heavy_check_mark:      | :x:                     |
| `StRSR.payoutRewards()`                 | :heavy_check_mark: | :heavy_check_mark:      | :heavy_check_mark:      |
| `StRSR.stake()`                         | :heavy_check_mark: | :heavy_check_mark:      | :heavy_check_mark:      |
| `StRSR.seizeRSR()`                      | :heavy_check_mark: | :x:                     | :x:                     |
| `StRSR.unstake()`                       | :heavy_check_mark: | :x:                     | :x:                     |
| `StRSR.withdraw()`                      | :heavy_check_mark: | :x:                     | :x:                     |

## Issuance-pause

The issuance-paused states indicates that RToken issuance should be paused, and _only_ that. It is a narrow control knob that is designed solely to protect against a case where bad debt is being injected into the protocol, say, because default detection for an asset has a false negative.

## Trading-pause

The trading-paused state has significantly more scope than the issuance-paused state. It is designed to prevent against cases where the protocol may trade unnecessarily. Many other functions in addition to just `BackingManager.rebalance()` and `RevenueTrader.manageTokens()` are halted. In general anything that manages the backing and revenue for an RToken is halted. This may become necessary to use due to (among other things):

- An asset's `price()` malfunctions or is manipulated
- A collateral's default detection has a false positive or negative

## Freezing

The scope of freezing is the largest, and it should be used least frequently. Nearly all protocol interactions (`@custom:interaction`) are halted. Any refreshers (`@custom:refresher`) remain enabled, as well as `StRSR.stake()` and the "wrap up" routine `*.settleTrade()`.

An important function of freezing is to provide a finite time for governance to push through a repair proposal an RToken in the event that a 0-day is discovered that requires a contract upgrade.

### `Furnace.melt()`

It is necessary for `Furnace.melt()` to remain enabled in order to allow `RTokenAsset.refresh()` to update its `price()`. Any revenue RToken that has already accumulated at the Furnace will continue to be melted, but the flow of new revenue RToken into the contract is halted.

### `StRSR.payoutRewards()`

It is necessary for `StRSR.payoutRewards()` to remain enabled in order for `StRSR.stake()` to use the up-to-date StRSR-RSR exchange rate. If it did not, then in the event of freezing there would be an unfair benefit to new stakers. Any revenue RSR that has already accumulated at the StRSR contract will continue to be paid out, but the flow of new revenue RSR into the contract is halted.

### `StRSR.stake()`

It is important for `StRSR.stake()` to remain enabled while frozen in order to allow honest RSR to flow into an RToken to vote against malicious governance proposals.

### `*.settleTrade()`

The settleTrade functionality must remain enabled in order to maintain the property that dutch auctions will discover the optimal price. If settleTrade were halted, it could become possible for a dutch auction to clear at a much lower price than it should have, simply because bidding was disabled during the earlier portion of the auction.
