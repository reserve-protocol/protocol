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
- Add `RToken.issue*(.., bool revertOnPartialRedemption)` and `RToken.redeem*(.., bool revertOnPartialRedemption)` to enable msg sender to control whether they will accept partial redemptions or not
- Add `RToken.issuanceAvailable()` + `RToken.redemptionAvailable()`
- Add `FacadeRead.primeBasket()` + `FacadeRead.backupConfig()` views
- Remove `IBasketHandler.nonce()` from interface, though it remains on `BasketHandler` contracts
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
- FacadeRead: remove `.pendingIssuances()` + `.endIdForVest()`
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
- Disallow staking while FROZEN
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
