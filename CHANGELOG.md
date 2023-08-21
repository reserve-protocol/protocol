# Changelog

# 3.1.0 - Unreleased

### Upgrade Steps -- Required

Upgrade `BackingManager`, `Broker`, `DutchTrade`, and _all_ assets

Then call `Broker.cacheComponents()`.

### Core Protocol Contracts

- `Broker` [+0 slots]

### Core Protocol Contracts

- `BackingManager`
  - Replace use of `lotPrice()` with `price()`
- `Broker` [+1 slot]
  - Disallow starting dutch trades with non-RTokenAsset assets when `lastSave() != block.timestamp`
  - Restrict disabling dutch auctions to BackingManager-started trades

## Plugins

### Assets

- Remove `lotPrice()`
- Make `price().low` decay downwards like old `lotPrice()`
- Make `price().high` decay upwards to 3x the saved high price

# 3.0.0 - Unreleased

### Upgrade Steps

#### Required Steps

Update _all_ component contracts, including Main.

Call the following functions:

- `BackingManager.cacheComponents()`
- `RevenueTrader.cacheComponents()` (for both rsrTrader and rTokenTrader)
- `Distributor.cacheComponents()`

Collateral / Asset plugins from 2.1.0 do not need to be upgraded with the exception of Compound V2 cToken collateral ([CTokenFiatCollateral.sol](contracts/plugins/assets/compoundv2/CTokenFiatCollateral.sol)), which needs to be swapped in via `AssetRegistry.swapRegistered()`. Skipping this step will result in COMP rewards becoming unclaimable. Note that this will change the ERC20 for the collateral plugin, causing the protocol to trade out of the old ERC20. Since COMP rewards are claimed on every transfer, COMP does not need to be claimed beforehand.

#### Optional Steps

Call the following functions, once it is desired to turn on the new features:

- `BaasketHandler.setWarmupPeriod()`
- `StRSR.setWithdrawalLeak()`
- `Broker.setDutchAuctionLength()`

### Core Protocol Contracts

Bump solidity version to 0.8.19

Bump solidity version to 0.8.19

- `AssetRegistry` [+1 slot]
  Summary: Other component contracts need to know when refresh() was last called
  - Add last refresh timestamp tracking and expose via `lastRefresh()` getter
  - Add `size()` getter for number of registered assets
- `BackingManager` [+2 slots]
  Summary: manageTokens was broken out into rebalancing and surplus-forwarding functions to allow users to more precisely call the protocol

  - Replace `manageTokens(IERC20[] memory erc20s)` with:
    - `rebalance(TradeKind)` + `RecollateralizationLibP1`
      - Modify trading algorithm to not trade RToken, and instead dissolve it when it has a balance above ~1e6. "dissolve" = melt() with a basketsNeeded change, like redemption.
      - Add significant caching to save gas
    - `forwardRevenue(IERC20[] memory erc20s)`
      - Modify backingBuffer logic to keep the backing buffer in collateral tokens only. Fix subtle and inconsequential bug that resulted in not maximizing RToken minting locally, though overall RToken production would not have been lower.
      - Use `nonReentrant` over CEI pattern for gas improvement. related to discussion of [this](https://github.com/code-423n4/2023-01-reserve-findings/issues/347) cross-contract reentrancy risk
    - move `nonReentrant` up outside `tryTrade` internal helper
  - Remove `manageTokensSortedOrder(IERC20[] memory erc20s)`
  - Modify `settleTrade(IERC20 sell)` to call `rebalance()` when caller is a trade it deployed.
  - Remove all `delegatecall` during reward claiming
  - Functions now revert on unproductive executions, instead of no-op
  - Do not trade until a warmupPeriod (last time SOUND was newly attained) has passed
  - Add `cacheComponents()` refresher to be called on upgrade
  - Bugfix: consider `maxTradeVolume()` from both assets on a trade, not just 1

- `BasketHandler` [+5 slots]
  Summary: Introduces a notion of basket warmup to defend against short-term oracle manipulation attacks. Prevent RTokens from changing in value due to governance

  - Add new gov param: `warmupPeriod` with setter `setWarmupPeriod(..)` and event `WarmupPeriodSet()`
  - Add `isReady()` view
  - Extract basket switching logic out into external library `BasketLibP1`
  - Enforce `setPrimeBasket()` does not change the net value of a basket in terms of its target units
  - Add `quoteCustomRedemption(uint48[] basketNonces, uint192[] memory portions, ..)` to quote a linear combination of current-or-previous baskets for redemption
  - Add `getHistoricalBasket(uint48 basketNonce)` view

- `Broker` [+1 slot]
  Summary: Add a new trading plugin that performs single-lot dutch auctions. Batch auctions via Gnosis EasyAuction are expected to be the backup auction (can be faster if more gas costly) going forward.

  - Add `TradeKind` enum to track multiple trading types
  - Add new dutch auction `DutchTrade`
  - Add minimum auction length of 24s; applies to all auction types
  - Rename variable `auctionLength` -> `batchAuctionLength`
  - Rename setter `setAuctionLength()` -> `setBatchAuctionLength()`
  - Rename event `AuctionLengthSet()` -> `BatchAuctionLengthSet()`
  - Add `dutchAuctionLength` and `setDutchAuctionLength()` setter and `DutchAuctionLengthSet()` event
  - Add `dutchTradeImplementation` and `setDutchTradeImplementation()` setter and `DutchTradeImplementationSet()` event
  - Modify `openTrade(TradeRequest memory reg)` -> `openTrade(TradeKind kind, TradeRequest memory req)`
    - Allow when paused / frozen, since caller must be in-system

- `Deployer` [+0 slots]
  Summary: Support new governance params

  - Modify to handle new gov params: `warmupPeriod`, `dutchAuctionLength`, and `withdrawalLeak`
  - Do not grant OWNER any of the roles other than ownership

- `Distributor` [+0 slots]
  Summary: Waste of gas to double-check this, since caller is another component
  - Remove `notPausedOrFrozen` modifier from `distribute()`
- `Furnace` [+0 slots]
  Summary: Should be able to melting while redeeming when frozen
  - Modify `melt()` modifier: `notPausedOrFrozen` -> `notFrozen`
- `Main` [+0 slots]
  Summary: Breakup pausing into two types of pausing: issuance and trading

  - Break `paused` into `issuancePaused` and `tradingPaused`
  - `pause()` -> `pauseTrading()` and `pauseIssuance()`
  - `unpause()` -> `unpauseTrading()` and `unpauseIssuance()`
  - `pausedOrFrozen()` -> `tradingPausedOrFrozen()` and `issuancePausedOrFrozen()`
  - `PausedSet()` event -> `TradingPausedSet()` and `IssuancePausedSet()`

- `RevenueTrader` [+3 slots]
  Summary: QoL improvements. Make compatible with new dutch auction trading method

  - Remove `delegatecall` during reward claiming
  - Add `cacheComponents()` refresher to be called on upgrade
  - `manageToken(IERC20 sell)` -> `manageToken(IERC20 sell, TradeKind kind)`
    - Allow `manageToken(..)` to open dust auctions
    - Revert on 0 balance or collision auction, instead of no-op
    - Refresh buy and sell asset before trade
  - `settleTrade(IERC20)` now distributes `tokenToBuy`, instead of requiring separate `manageToken(IERC20)` call

- `RToken` [+0 slots]
  Summary: Provide multiple redemption methods for when fullyCollateralized vs not. Should support a higher RToken price during basket changes.

  - Remove `exchangeRateIsValidAfter` modifier from all functions except `setBasketsNeeded()`
  - Modify `issueTo()` to revert before `warmupPeriod`
  - Modify `redeem(uint256 amount, uint48 basketNonce)` -> `redeem(uint256 amount)`. Redemptions are on the current basket nonce and revert under partial redemption
  - Modify `redeemTo(address recipient, uint256 amount, uint48 basketNonce)` -> `redeemTo(address recipient, uint256 amount)`. Redemptions are on the current basket nonce and revert under partial redemption
  - Add new `redeemCustom(.., uint256 amount, uint48[] memory basketNonces, uint192[] memory portions, ..)` function to allow redemption from a linear combination of current and previous baskets. During rebalancing this method of redemption will provide a higher overall redemption value than prorata redemption on the current basket nonce would.
  - `mint(address recipient, uint256 amtRToken)` -> `mint(uint256 amtRToken)`, since recipient is _always_ BackingManager. Expand scope to include adjustments to `basketsNeeded`
  - Add `dissolve(uint256 amount)`: burns RToken and reduces `basketsNeeded`, similar to redemption. Only callable by BackingManager
  - Modify `setBasketsNeeded(..)` to revert when supply is 0

- `StRSR` [+2 slots]
  Summary: Add the ability to cancel unstakings and a withdrawal() gas-saver to allow small RSR amounts to be exempt from refreshes

  - Remove duplicate `stakeRate()` getter (same as `1 / exchangeRate()`)
  - Add `withdrawalLeak` gov param, with `setWithdrawalLeak(..)` setter and `WithdrawalLeakSet()` event
  - Modify `withdraw()` to allow a small % of RSR too exit without paying to refresh all assets
  - Modify `withdraw()` to check for `warmupPeriod`
  - Add ability to re-stake during a withdrawal via `cancelUnstake(uint256 endId)`
  - Add `UnstakingCancelled()` event

- `StRSRVotes` [+0 slots]
  - Add `stakeAndDelegate(uint256 rsrAmount, address delegate)` function, to encourage people to receive voting weight upon staking

### Facades

- `FacadeWrite`
  Summary: More expressive and fine-grained control over the set of pausers and freezers

  - Do not automatically grant Guardian PAUSER/SHORT_FREEZER/LONG_FREEZER
  - Do not automatically grant Owner PAUSER/SHORT_FREEZER/LONG_FREEZER
  - Add ability to initialize with multiple pausers, short freezers, and long freezers
  - Modify `setupGovernance(.., address owner, address guardian, address pauser)` -> `setupGovernance(.., GovernanceRoles calldata govRoles)`
  - Update `DeploymentParams` and `Implementations` struct to contain new gov params and dutch trade plugin

- `FacadeAct`
  Summary: Remove unused getActCalldata and add way to run revenue auctions

  - Remove `getActCalldata(..)`
  - Modify `runRevenueAuctions(..)` to work with both 3.0.0 and 2.1.0 interfaces

- `FacadeRead`
  Summary: Add new data summary views frontends may be interested in

  - Remove `basketNonce` from `redeem(.., uint48 basketNonce)`
  - Remove `traderBalances(..)`
  - `balancesAcrossAllTraders(IBackingManager) returns (IERC20[] memory erc20s, uint256[] memory balances, uint256[] memory balancesNeededByBackingManager)`
  - Add `nextRecollateralizationAuction(..) returns (bool canStart, IERC20 sell, IERC20 buy, uint256 sellAmount)`
  - Add `revenueOverview(IRevenueTrader) returns ( IERC20[] memory erc20s, bool[] memory canStart, uint256[] memory surpluses, uint256[] memory minTradeAmounts)`

- Remove `FacadeMonitor` - redundant with `nextRecollateralizationAuction()` and `revenueOverview()`

## Plugins

### DutchTrade

A cheaper, simpler, trading method. Intended to be the new dominant trading method, with GnosisTrade (batch auctions) available as a faster-but-more-gas-expensive backup option.

DutchTrade implements a two-stage, single-lot, falling price dutch auction. In the first 40% of the auction, the price falls from 1000x to the best-case price in a geometric/exponential decay as a price manipulation defense mechanism. Bids are not expected to occur (but note: unlike the GnosisTrade batch auction, this mechanism is not resistant to _arbitrary_ price manipulation).

Over the last 60% of the auction, the price falls linearly from the best-case price to the worst-case price. Only a single bidder can bid fill the auction, and settlement is atomic. If no bids are received, the capital cycles back to the BackingManager and no loss is taken.

Duration: 30 min (default)

### Assets and Collateral

- Bugfix: `lotPrice()` now begins at 100% the lastSavedPrice, instead of below 100%. It can be at 100% for up to the oracleTimeout in the worst-case.
- Add `version() return (string)` getter to pave way for separation of asset versioning and core protocol versioning
- Update `claimRewards()` on all assets to 3.0.0-style, without `delegatecall`
- Add `lastSave()` to `RTokenAsset`

# 2.1.0

### Core protocol contracts

- `BasketHandler`
  - Bugfix for `getPrimeBasket()` view
  - Minor change to `_price()` rounding
  - Minor natspec improvement to `refreshBasket()`
- `Broker`
  - Fix `GnosisTrade` trade implemention to treat defensive rounding by EasyAuction correctly
  - Add `setGnosis()` and `setTradeImplementation()` governance functions
- `RToken`
  - Minor gas optimization added to `redeemTo` to use saved `assetRegistry` variable
- `StRSR`
  - Expose RSR variables via `getDraftRSR()`, `getStakeRSR()`, and `getTotalDrafts()` views

### Facades

- `FacadeRead`
  - Extend `issue()` to return the estimated USD value of deposits as `depositsUoA`
  - Add `traderBalances()`
  - Add `auctionsSettleable()`
  - Add `nextRecollateralizationAuction()`
  - Modify `backingOverview() to handle unpriced cases`
- `FacadeAct`
  - Add `runRevenueAuctions()`

### Plugins

#### Assets and Collateral

Across all collateral, `tryPrice()` was updated to exclude revenueHiding considerations

- Deploy CRV + CVX plugins
- Add `AnkrStakedEthCollateral` + tests + deployment/verification scripts for ankrETH
- Add FluxFinance collateral tests + deployment/verification scripts for fUSDC, fUSDT, fDAI, and fFRAX
- Add CompoundV3 `CTokenV3Collateral` + tests + deployment/verification scripts for cUSDCV3
- Add Convex `CvxStableCollateral` + tests + deployment/verification scripts for 3Pool
- Add Convex `CvxVolatileCollateral` + tests + deployment/verification scripts for Tricrypto
- Add Convex `CvxStableMetapoolCollateral` + tests + deployment/verification scripts for MIM/3Pool
- Add Convex `CvxStableRTokenMetapoolCollateral` + tests + deployment/verification scripts for eUSD/fraxBP
- Add Frax `SFraxEthCollateral` + tests + deployment/verification scripts for sfrxETH
- Add Lido `LidoStakedEthCollateral` + tests + deployment/verification scripts for wstETH
- Add RocketPool `RethCollateral` + tests + deployment/verification scripts for rETH

### Testing

- Add generic collateral testing suite at `test/plugins/individual-collateral/collateralTests.ts`
- Add EasyAuction regression test for Broker false positive (observed during USDC de-peg)
- Add EasyAuction extreme tests

### Documentation

- Add `docs/plugin-addresses.md` as well as accompanying script for generation at `scripts/collateral-params.ts`
- Add `docs/exhaustive-tests.md` to document running exhaustive tests on GCP

# 2.0.0

Candidate release for the "all clear" milestone. There wasn't any real usage of the 1.0.0/1.1.0 releases; this is the first release that we are going to spend real effort to remain backwards compatible with.

- Bump solidity version to 0.8.17
- Support multiple beneficiaries via the [`FacadeWrite`](contracts/facade/FacadeWrite.sol)
- Add `RToken.issueTo(address recipient, uint256 amount, ..)` and `RToken.redeemTo(address recipient, uint256 amount, ..)` to support issuance/redemption to a different address than `msg.sender`
- Add `RToken.redeem*(.., uint256 basketNonce)` to enable msg sender to control expectations around partial redemptions
- Add `RToken.issuanceAvailable()` + `RToken.redemptionAvailable()`
- Add `FacadeRead.primeBasket()` + `FacadeRead.backupConfig()` views
- Many external libs moved to internal
- Switch from price point estimates to price ranges; all prices now have a `low` and `high`. Impacted interface functions:
  - `IAsset.price()`
  - `IBasketHandler.price()`
- Replace `IAsset.fallbackPrice()` with `IAsset.lotPrice()`. The lot price is the current price when available, and a fallback price otherwise.
- Introduce decaying fallback prices. Over a finite period of time the fallback price goes to zero, linearly.
- Remove `IAsset.pricePerTarget()` from asset interface
- Remove rewards earning and sweeping from RToken
- Add `safeMulDivCeil()` to `ITrading` traders. Use when overflow is possible from 2 locations:
  - [RecollateralizationLib.sol:L271](contracts/p1/mixins/RecollateralizationLib.sol)
  - [TradeLib.sol:L59](contracts/p1/mixins/TradeLib.sol)
- Introduce config struct to encapsulate Collateral constructor params more neatly
- In general it should be easier to write Collateral plugins. Implementors should _only_ ever have to override 4 functions: `tryPrice()`, `refPerTok()`, `targetPerRef()`, and `claimRewards()`.
- Add `.div(1 - maxTradeSlippage)` to calculation of `shortfallSlippage` in [RecollateralizationLib.sol:L188](contracts/p1/mixins/RecollateralizationLib.sol).
- FacadeRead:
  - remove `.pendingIssuances()` + `.endIdForVest()`
  - refactor calculations in `basketBreakdown()`
- Bugfix: Fix claim rewards from traders in `FacadeAct`
- Bugfix: Do not handout RSR rewards when no one is staked
- Bugfix: Support small redemptions even when the RToken supply is massive
- Bump component-wide `version()` getter to 2.0.0
- Remove non-atomic issuance
- Replace redemption battery with issuance and redemption throttles
  - `amtRate` valid range: `[1e18, 1e48]`
  - `pctRate` valid range: `[0, 1e18]`
- Fix Furnace/StRSR reward period to 12 seconds
- Gov params:
  - --`rewardPeriod`
  - --`issuanceRate`
  - ++`issuanceThrottle`
  - ++`redemptionThrottle`
- Events:
  - --`RToken.IssuanceStarted`
  - --`RToken.IssuancesCompleted`
  - --`RToken.IssuancesCanceled`
  - `Issuance( address indexed recipient, uint256 indexed amount, uint192 baskets )` -> `Issuance( address indexed issuer, address indexed recipient, uint256 indexed amount, uint192 baskets )`
  - `Redemption(address indexed recipient, uint256 indexed amount, uint192 baskets )` -> `Redemption(address indexed redeemer, address indexed recipient, uint256 indexed amount, uint192 baskets )`
  - ++`RToken.IssuanceThrottleSet`
  - ++`RToken.RedemptionThrottleSet`
- Allow redemption while DISABLED
- Allow `grantRTokenAllowances()` while paused
- Add `RToken.monetizeDonations()` escape hatch for accidentally donated tokens
- Collateral default threshold: 5% -> 1% (+ include oracleError)
- RecollateralizationLib: Tighter basket range during recollateralization. Will now do `minTradeVolume`-size auctions to fill in dust rather than haircut.
- Remove StRSR.setName()/setSymbol()
- Prevent RToken exchange rate manipulation at low supply
- Prevent StRSR exchange rate manipulation at low supply
- Forward RSR directly to StRSR, bypassing RSRTrader
- Accumulate melting on `Furnace.setRatio()`
- Payout RSR rewards on `StRSR.setRatio()`
- Distinguish oracle timeouts when dealing with multiple oracles in one plugin
- Add safety during asset degregistration to ensure it is always possible to unregister an infinite-looping asset
- Fix `StRSR`/`RToken` EIP712 typehash to use release version instead of "1"
- Add `FacadeRead.redeem(IRToken rToken, uint256 amount, uint48 basketNonce)` to return the expected redemption quantities on the basketNonce, or revert
- Integrate with OZ 4.7.3 Governance (changes to `quorum()`/t`proposalThreshold()`)

# 1.1.0

- Introduce semantic versioning to the Deployer and RToken
- `RTokenCreated` event: added `version` argument

```
event RTokenCreated(
        IMain indexed main,
        IRToken indexed rToken,
        IStRSR stRSR,
        address indexed owner
    );

```

=>

```
event RTokenCreated(
        IMain indexed main,
        IRToken indexed rToken,
        IStRSR stRSR,
        address indexed owner,
        string version
    );

```

- Add `version()` getter on Deployer, Main, and all Components, via mix-in. To be updated with each subsequent release.

[d757d3a5a6097ae42c71fc03a7c787ec001d2efc](https://github.com/reserve-protocol/protocol/commit/d757d3a5a6097ae42c71fc03a7c787ec001d2efc)

# 1.0.0

(This release is the one from the canonical lauch onstage in Bogota. We were missing semantic versioning at the time, but we call this the 1.0.0 release retroactively.)

[eda322894a5ed379bbda2b399c9d1cc65aa8c132](https://github.com/reserve-protocol/protocol/commit/eda322894a5ed379bbda2b399c9d1cc65aa8c132)

# Links

- [[Unreleased]](https://github.com/reserve-protocol/protocol/releases/tag/3.0.0-rc1)
  - https://github.com/reserve-protocol/protocol/compare/2.1.0-rc4...3.0.0
- [[2.1.0]](https://github.com/reserve-protocol/protocol/releases/tag/2.1.0-rc4)
  - https://github.com/reserve-protocol/protocol/compare/2.0.0-candidate-4...2.1.0-rc4
- [[2.0.0]](https://github.com/reserve-protocol/protocol/releases/tag/2.0.0-candidate-4)
  - https://github.com/reserve-protocol/protocol/compare/1.1.0...2.0.0-candidate-4
- [[1.1.0]](https://github.com/reserve-protocol/protocol/releases/tag/1.1.0)
  - https://github.com/reserve-protocol/protocol/compare/1.0.0...1.1.0
- [[1.0.0]](https://github.com/reserve-protocol/protocol/releases/tag/1.0.0)
  - https://github.com/reserve-protocol/protocol/releases/tag/1.0.0
