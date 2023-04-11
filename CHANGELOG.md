# Changelog

## 1.0.0

(This release is the one from the canonical lauch onstage in Bogota. We were missing semantic versioning at the time, but we call this the 1.0.0 release retroactively.)

Deploy commit [eda322894a5ed379bbda2b399c9d1cc65aa8c132](https://github.com/reserve-protocol/protocol/commit/eda322894a5ed379bbda2b399c9d1cc65aa8c132)

## 1.1.0

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

Deploy commit [d757d3a5a6097ae42c71fc03a7c787ec001d2efc](https://github.com/reserve-protocol/protocol/commit/d757d3a5a6097ae42c71fc03a7c787ec001d2efc)

## 2.0.0

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

## 2.1.0

#### Core protocol contracts

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

#### Facades

- `FacadeRead`
  - Extend `issue()` to return the estimated USD value of deposits as `depositsUoA`
  - Add `traderBalances()`
  - Add `auctionsSettleable()`
  - Modify `backingOverview() to handle unpriced cases`
- `FacadeAct`
  - Add `canRunRecollateralizationAuctions()`
  - Add `getRevenueAuctionERC20s()`
  - Add `runRevenueAuctions()`

#### Assets

- Deploy CRV + CVX plugins

#### Collateral

Across all collateral, `tryPrice()` was updated to exclude revenueHiding considerations

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

#### Testing

- Add generic collateral testing suite at `test/plugins/individual-collateral/collateralTests.ts`
- Add EasyAuction regression test for Broker false positive (observed during USDC de-peg)
- Add EasyAuction extreme tests

#### Documentation

- Add `docs/plugin-addresses.md` as well as accompanying script for generation at `scripts/collateral-params.ts`
- Add `docs/exhaustive-tests.md` to document running exhaustive tests on GCP
