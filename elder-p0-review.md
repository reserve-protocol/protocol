# TODOs
- [ ] Move as much as possible into assets (no more unapproving collateral; rename `poke`)
- [ ] Move BU ownership to RToken + change vesting locations
- [ ] Get rid of Mood, check that all assets in current vault are SOUND
- [ ] notice -> checkFor
- [ ] EmptyVault impl?
- [ ] DefaultHandler overhaul, move vault checks into the vault class
- [ ] _nextIssuanceBlockAvailable() - add fractional "how far into the block" metric 
- [ ] (beforeUpdate() calls not actually going through the entire set of mixins)
- [ ] Add `toUint` with enum rounding forwarding the call to floor/ceil/round

# DO LATER (or think harder about)
- [ ] Rehaul how we express the backup DAG / do backups


# AssetRegistry
- [ ] At least for p0, it seems better to track the approved/defaulted status on the *asset*, rather than as a list in Main. This change would:
    - Move isApproved() and make markDefaul() in ICollateral; 
    - Remove the _approvedCollateral AddressSet from AssetRegistry
    - Add an approvedCollateral() accessor (returns an array) to AssetRegistry
    - Replace current set accessses with that accessor

After discussion: No main on priceUSD call, asset is permissioned, Main updates it for asset registration and defaulting status (SOUND, IFFY, DEFAULTED)
8/10

# RevenueDistributor
- [x] Is there any way to move the RevenueShare type closer to RevenueDistributor?

- [x] RevenueDistributor.distribute() will hit failures due to rounding -- if rounding brings the total below amount, it'll leave dust; if rounding brings the total above amount, it'll revert.
    - Solution: The final transfer in the series should go to the "protocol" (rtoken or stRSR), and should sweep whatever is left after a running total.

# VaultHandler
- [ ] _switchVault: why do we call beforeUpdate() a second time? If we need to call a more-subclass beforeUpdate, we need to call this.beforeUpdate(); just calling beforeUpdate() won't work. #BUs-to-RToken


# DefaultHandler:
- [ ] We've still got setMood in places. Turn that into some sort of semantic set of calls on Moody; I bet we catch at least one big bug that way.
    - _tryEnsureValidVault's usage of _setMood is especially worrying!

- [ ] suggest renaming:
    - _notice* -> _checkFor*
    - _vaultIsDefaulting -> _isDefaulting

- [ ] _noticeHardDefault could loop through just the current vault, instead of *approved collateral*. (Upper bounds how long it takes)

- [ ] The entire collateral approval state feels wrong to me. Should be local to each Collateral token.

- [ ] We should have a policy on what to do if we need to switch vaults and there are none available to switch to.

- [ ] Either ICollateral.poke() should be better named, or coll.isDefaulting be made separate.

- [ ] In *P1* (not here), consider making the _defaultThreshold median computation faster. At least use a faster sort!

---

This code and its comments would benefit from much greater clarity. What's "approved"? Exactly what's "defaulting"? I think the current definitions go like this:

- Collateral is _approved_ if it's in Main._approvedCollateral; think of this as a flag on the Collateral contract.
    - Collateral is approved when it's introduced to the system
    - Collateral is unapproved when it's fully defaulted -- it's had either
        - a hard default, or
        - a soft default that timed out before recovering.
- Collateral _is defaulting_ if it's in a soft default that has not yet recovered.
  (This is confusing!)

I loosely propose the following terminology instead:

- Collateral is _registered_ if it's referred to by the AssetRegistry.
    - Collateral, once registered, is never deregistered.
    - A vault can only be added to the system of all of its collateral is registered.
- Collateral can be in one of three possible states: SOUND > IFFY > DEFAULTED > (UNREGISTERED)
    - Collateral starts out SOUND, the highest rating.
    - Collateral is IFFY if it's in the middle of soft default -- it registered a soft default not long ago, and it has not yet recovered. IFFY is temporary, and will become SOUND or DEFAULTED depending on future events.
    - Collateral is downgraded to DEFAULTED when it hard defaults, or times out on a soft default. Collateral with DEFAULTED status keeps that status.
    - If it's useful, we can include an UNREGISTERED status in here, but I'll be a little surprised if we ever need it.

Once you do all that, _vaultIsDefaulting and _isValid functions can be collapsed into a single function (on the Vault class!) that returns the minimum CollateralStatus of any of the Collateral it contains.


# Auctioneer

- [ ] Main currently owns the basket units that the RToken redeems with. Why doesn't the RToken own them instead? #BUs-to-RToken

# RTokenIssuer
- [ ] The start of issue() calls a bunch of things - furnace.melt, notieHardDefault, and ensureValidVault. Should these be on a beforeIssue() hook? Probably not, but then how do you model why we're calling these functions here, and how do we know it's complete?
- [ ] During slow issuance -- between issue() and that issuance getting completed -- Main holds the vault BUs, and the RToken holds the minted RTokens. Probably these should be in a single place for sensible accounting purposes? #BUs-to-RToken
- [ ] The way _nextIssuanceBlockAvailable is set up, we'll only be able to do one issuance per block even if the issuances are pretty small. To fixup, we should also save how far "into" its block that last issuance will end.

# Trader
- [x] I'm uncomfortable with the way we reuse Auction structs to be reinterpreted in so many different ways. It feels like a plausible source of latent errors, but I don't really see a better way to do it. Revisit...

# BackingTrader
- [x] In poke, should _tryCreateBUs and _startNextAuction() also be under the condition targetBUs > 0?

# Vault
- [ ] Think hard about how we represent backups... (Maybe a list of Baskets instead?)
- [x] claimAndSweepRewards -- are we sure we can't just have that be an automatic member of this class? (Maybe we subclass RewardsLib instead of library-include it?)
- [x] Vault.backingAmounts is very analogous to Main.quote; should we also call it Vault.quote?
- [ ] issue and redeem compute their amounts using the same rounding mode, so rounding errors might creep in. (Possible solution: backingAmounts supports 

# StRSR
- [x] processWithdrawals() enforces that the withdrawals occur in the order they're added to the `withdrawals` array, which might not be the order of increasing `avaiableAt` values. (e.g, if a governance error causes the withdrawal delay to be year, a withdrawal occurs, and then the delays is reduced again, withdrawal is still locked for a year.) Probably the simplest fix is to save `startedAt` instead of `availableAt`, and use main.stRSRWithdrawalDelay() when checking which withdrawals are available.
    
      Alternately, we can keep using `availableAt`, and maintain `withdrawals` as a priority queue. O(lg(N)) for adds and removes, instead of possibly O(N) to add to a fully-sorted list.

# Meta
- [x] Groom TODOs
- [ ] Before passing review, the code should be clear of TODOs, or we've at least decided that each one is, for some special reason, right to leave in for now.
