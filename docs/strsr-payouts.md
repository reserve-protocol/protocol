# Proof of StRSR payouts formula

I know this is a lot of text for a simple thing, but we've lost track of the proof a few times, so it's probably worth pinning down somewhere. The same formula is used in the Furnace to handle the same situation.

---

StRSR.\_payoutRewards() implements the following payout formula:

    payout = rsrRewardsAtLastPayout() * ( 1 - (1 - rewardRatio) ** numPeriods )

It claims that payout, here, is equivalent to the totalPayout produced by the following Python-ish pseudocode, which simulates performing N individual payout rounds, numbered from 1 to N. Defining:

- `r` is the `rewardRatio`,
- `p[i]` is the payout during round `i`,
- `rwd[i]` is the payout remaining after round `i`.

Then we have the following process:

    p[0] = 0
    rwd[0] = rsrRewardsAtLastPayout()
    for i from 1 to N:
        p[i] = rwd[i-1] * r
        rwd[i] = rwd[i-1] - p[i]

    payout = sum(from 1 to N)(p)

Notice that, in this pseudocode, every variable is only set once, so we can use `p[i]` outside of the running code as the name of value it's set to; this will help us in our proofs.

Claim: `payout`, implemented in the payout formula above, is equal to the value of `payout` in the pseudocode for the N-step process.

Proof:

1. For `0 < i <= N`, `rwd[i] = rwd[i-1] * (1 - r)`

   See this with simple algebra: `rwd[i] = rwd[i-1] - p[i] = rwd[i-1] - (rwd[i-1] * r) = rwd[i-1] * (1-r)`

2. For `0 <= i <= N`, `rwd[i] = rwd[0] * (1-r) ** i`

   See this by induction on claim (1).

3. `rwd[N] = rwd[0] - sum(from 1 to N)(p)`

   See this by induction on `k`, for the claim `rwd[k] = rwd[0] - sum(from 1 to k)(p)`, and the definition of `rwd[i]`.

4. `payout = rwd[0] * (1 - (1-r)**N)`

   - We defined `payout` as: `payout = sum(from 1 to N)(p)`
   - By claim 3, we have: `rwd[N] = rwd[0] - payout`
   - Rearranging: `payout = rwd[0] - rwd[N]`
   - By claim 2, that gives us `payout = rwd[0] - rwd[0] * (1-r) ** N`
   - And so we get `payout = rwd[0] * (1 - (1-r)**N)`

Claim (4) is simply equivalent to the truth of our payout formula, above.

---
