---
sponsor: "Reserve"
slug: "2024-07-reserve"
date: "2024-10-03"
title: "Reserve Core"
findings: "https://github.com/code-423n4/2024-07-reserve-findings/issues"
contest: 421
---

# Overview

## About C4

Code4rena (C4) is an open organization consisting of security researchers, auditors, developers, and individuals with domain expertise in smart contracts.

A C4 audit is an event in which community participants, referred to as Wardens, review, audit, or analyze smart contract logic in exchange for a bounty provided by sponsoring projects.

During the audit outlined in this document, C4 conducted an analysis of the Reserve Core smart contract system written in Solidity. The audit took place between July 29—August 19 2024.

Following the C4 audit, 4 wardens ([RadiantLabs](https://code4rena.com/@RadiantLabs) ([3docSec](https://code4rena.com/@3docSec) and [EV\_om](https://code4rena.com/@EV_om)), [ether\_sky](https://code4rena.com/@ether_sky) and [Bauchibred](https://code4rena.com/@Bauchibred)) reviewed the mitigations for all identified issues; the [mitigation review report](#mitigation-review) is appended below the audit report.

## Wardens

19 Wardens contributed reports to Reserve Core:

  1. [RadiantLabs](https://code4rena.com/@RadiantLabs) ([3docSec](https://code4rena.com/@3docSec) and [EV\_om](https://code4rena.com/@EV_om))
  2. [krikolkk](https://code4rena.com/@krikolkk)
  3. [ether\_sky](https://code4rena.com/@ether_sky)
  4. [Bauchibred](https://code4rena.com/@Bauchibred)
  5. [stuart\_the\_minion](https://code4rena.com/@stuart_the_minion)
  6. [Shield](https://code4rena.com/@Shield) ([Viraz](https://code4rena.com/@Viraz), [0xA5DF](https://code4rena.com/@0xA5DF), [Dravee](https://code4rena.com/@Dravee), [Udsen](https://code4rena.com/@Udsen), and [ElGreenGoblino](https://code4rena.com/@ElGreenGoblino))
  7. [SUPERMAN\_I4G](https://code4rena.com/@SUPERMAN_I4G)
  8. [Agontuk](https://code4rena.com/@Agontuk)
  9. [PolarizedLight](https://code4rena.com/@PolarizedLight) ([ChaseTheLight](https://code4rena.com/@ChaseTheLight) and [Auditor\_Nate](https://code4rena.com/@Auditor_Nate))
  10. [Rhaydden](https://code4rena.com/@Rhaydden)
  11. [DanielArmstrong](https://code4rena.com/@DanielArmstrong)
  12. [0x52](https://code4rena.com/@0x52)
  13. [Aamir](https://code4rena.com/@Aamir)

This audit was judged by [cccz](https://code4rena.com/@cccz).

Final report assembled by [liveactionllama](https://twitter.com/liveactionllama) and [thebrittfactor](https://twitter.com/brittfactorC4).

# Summary

The C4 analysis yielded an aggregated total of 7 unique vulnerabilities. Of these vulnerabilities, 0 received a risk rating in the category of HIGH severity and 7 received a risk rating in the category of MEDIUM severity.

Additionally, C4 analysis included 12 reports detailing issues with a risk rating of LOW severity or non-critical.

All of the issues presented here are linked back to their original finding.

# Scope

The code under review can be found within the [C4 Reserve Core repository](https://github.com/code-423n4/2024-07-reserve), and is composed of 34 smart contracts written in the Solidity programming language and includes 4,079 lines of Solidity code.

# Severity Criteria

C4 assesses the severity of disclosed vulnerabilities based on three primary risk categories: high, medium, and low/non-critical.

High-level considerations for vulnerabilities span the following key areas when conducting assessments:

- Malicious Input Handling
- Escalation of privileges
- Arithmetic
- Gas use

For more information regarding the severity criteria referenced throughout the submission review process, please refer to the documentation provided on [the C4 website](https://code4rena.com), specifically our section on [Severity Categorization](https://docs.code4rena.com/awarding/judging-criteria/severity-categorization).

# Medium Risk Findings (7)
## [[M-01] RToken can manipulate distribution to avoid paying DAO fees](https://github.com/code-423n4/2024-07-reserve-findings/issues/53)
*Submitted by [RadiantLabs](https://github.com/code-423n4/2024-07-reserve-findings/issues/53)*

Revenue produced by RTokens is sold for both RSR and RTokens according to a distribution defined in the [`Distributor`](https://github.com/code-423n4/2024-07-reserve/blob/3f133997e186465f4904553b0f8e86ecb7bbacbf/contracts/p1/Distributor.sol). The `BackingManager` [splits](https://github.com/code-423n4/2024-07-reserve/blob/3f133997e186465f4904553b0f8e86ecb7bbacbf/contracts/p1/BackingManager.sol#L247-L261) the collateral tokens to be sold proportionately to the RSR/RToken distribution ratio and sends them to the `rsrTrader` and `rTokenTrader`. When trades settle, the obtained RSR or RTokens are sent to the `Distributor`, which distributes them no longer according to the RSR/RToken ratio but to the different destinations for the specific token. The sum of all destinations for each token is used to derive the ratio.

The DAO fee is added to the RSR share of the initial split and paid when RSR is distributed.

However, the current implementation allows governance to manipulate the distribution settings without much effort in a way that can significantly reduce the amount of DAO fees paid.

This can be achieved through a combination of two different root causes:

*   an RSR destination can be added that prevents rewards from being immediately distributed
*   the RSR/RToken ratio is calculated twice: once in the  `BackingManager`, and once in the `Distributor`, and it is can be modified between the two

Essentially, the distribution can be set in a way that temporarily accumulates RSR revenue in in the `rsrTrader` according to one RSR/RToken ratio, and then later redistributed with a different ratio.

### Impact

RTokens can avoid paying most of the DAO fee

### Proof of Concept

Assuming a 10% DAO fee, governance can execute the following steps to pay only about 1% in fees:

1.  Set the distribution such that `rsrTotal == 0` before DAO fees [are added](https://github.com/code-423n4/2024-07-reserve/blob/3f133997e186465f4904553b0f8e86ecb7bbacbf/contracts/p1/Distributor.sol#L221).
2.  Add the RSR token itself as a distribution target. Like stRSR, [RSR](https://etherscan.io/token/0x320623b8e4ff03373931769a31fc52a4e78b5d70#code) does not allow transferring to itself, so the distribution will always fail.
3.  10% of revenue will accumulate as RSR in the `rsrTrader`.
4.  After some time, change the distribution such that `rTokenTotal == 0` and add another destination with non-zero `rsrDist` (e.g., `stRSR`).
5.  Remove RSR as a distribution target and call `rsrTrader.distributeTokenToBuy()`.
6.  Only 10% of the accumulated RSR will go to the DAO, which is effectively 1% of the total revenue.
7.  Repeat this process as needed.

### Recommended Mitigation Steps

Disallowing RSR as a distribution token prevents this to a large extent.

**[cccz (judge) commented](https://github.com/code-423n4/2024-07-reserve-findings/issues/53#issuecomment-2317900788):**
 > Will try to get the sponsor's opinion, and will set it to valid before the sponsor responds.<br>
> It's about Malicious Governance, though it actually compromises the DAO, so it's probably a privilege escalation.

**[akshatmittal (Reserve) disputed and commented](https://github.com/code-423n4/2024-07-reserve-findings/issues/53#issuecomment-2318254246):**
 > This is a known issue, changing Distributions in a specific way can change what is actually paid out to veRSR. See publicly known issues as well as the Trust report specifically.

**[tbrent (Reserve) commented](https://github.com/code-423n4/2024-07-reserve-findings/issues/53#issuecomment-2319277727):**
 > The way I'm seeing it: a new finding (RSR self-entries in the distributor table cause distribution to revert) raises the previously known issue [TRST-L-2](https://github.com/code-423n4/2024-07-reserve/blob/main/audits/Reserve_PR_4_0_0_v1.pdf) in severity from Low to Medium, due to what is effectively privilege escalation by avoiding paying the DAO fee. 

**[Reserve mitigated](https://github.com/code-423n4/2024-09-reserve-mitigation?tab=readme-ov-file#findings-being-mitigated)**

**Status:** Mitigation confirmed. Full details in reports from [Bauchibred](https://github.com/code-423n4/2024-09-reserve-mitigation-findings/issues/2), [ether_sky](https://github.com/code-423n4/2024-09-reserve-mitigation-findings/issues/24) and [RadiantLabs](https://github.com/code-423n4/2024-09-reserve-mitigation-findings/issues/14).

***

## [[M-02] Broken assumptions can lead to the inability to seize RSR](https://github.com/code-423n4/2024-07-reserve-findings/issues/39)
*Submitted by [krikolkk](https://github.com/code-423n4/2024-07-reserve-findings/issues/39)*

The `seizeRSR` [function](https://github.com/code-423n4/2024-07-reserve/blob/main/contracts/p1/StRSR.sol#L424) takes RSR from the staking contract when `BackingManager` wants to sell RSR, [but it does not have enough](https://github.com/code-423n4/2024-07-reserve/blob/main/contracts/p1/BackingManager.sol#L161). In this case, the stakers can lose a portion of their stake in order to keep the system healthy. However, an issue arises from broken assumptions about `stakeRSR` and `totalStakes`, which will make the contract unable to seize due to revert.

### Proof of Concept

Let's assume the system becomes unhealthy, and the stakers will start unstaking their tokens in fear of an upcoming reset/seize. Then, the expected event comes, and the `BackingManager` tries to seize RSR from the staking contract.

This action is frontran however, with the last staker who:

1.  unstakes everything
2.  stakes one token
3.  stakes one token again

Let's examine how does this break `seizeRSR`.

1.  During the `unstake` [call](https://github.com/code-423n4/2024-07-reserve/blob/main/contracts/p1/StRSR.sol#L259):
    *   `_payoutRewards` is called. Since `totalStakes` is still above `1e18`, `stakeRSR` can be increased and become greater than `totalStakes`. Let's assume that `totalStakes` would be `1000e18` and `stakeRSR` would end at `1001e18` after this step.
    *   Now, the `stakeRate` would be updated. Since `stakeRSR` is not zero yet, and so is not `totalStakes`, it would be set to
        ```Solidity
          uint192((totalStakes * FIX_ONE_256 + (stakeRSR - 1)) / stakeRSR)
        ```
        which translates to
        ```Solidity
          uint192((1000e18 * 1e18 + (1001e18 - 1)) / 1001e18)
        ```
        resulting in `999000999000999001`
    *   `totalStakes` would be decreased in `_burn` by `1000e18` to zero, which would result in `stakeRSR` being set to zero
2.  During the `stake` [call](https://github.com/code-423n4/2024-07-reserve/blob/main/contracts/p1/StRSR.sol#L227):
    *   `payoutRewards` is skipped because it was already called in this block
    *   `newTotalStakes` in `mintStakes` is calculated as `(stakeRate * newStakeRSR) / FIX_ONE`, which translates to `(stakeRate * (stakeRSR + rsrAmount)) / FIX_ONE` which translates to `(999000999000999001 * (0 + 1)) / 1e18` resulting in 0, meaning 0 tokens are minted and `totalStakes` remains 0
    *   `stakeRSR` is increased by 1
3.  The second `stake` call will have the same effects
    *   after this call, the `stakeRate` is `999000999000999001`, `totalStakes` is 0, and `stakeRSR` is 2 (note that this breaks [this assumption](https://github.com/code-423n4/2024-07-reserve/blob/main/contracts/p1/StRSR.sol#L619-L620))
4.  Now we examine the important parts of the `seizeRSR` call
    *   `stakeRSRToTake` is set to `(2 * rsrAmount + (rsrBalance - 1)) / rsrBalance`, which will result in 1 every time the we are not seizing more than half of the total balance of the contract
    *   `stakeRSR` is therefore set to 1, and since it is non-zero, `stakeRate` is updated to `uint192((FIX_ONE_256 * totalStakes + (stakeRSR - 1)) / stakeRSR)`, which translates to `uint192((1e18 * 0 + (1 - 1)) / 1)` which comes to 0
    *   the rest of the call is not important until it comes to
        ```Solidity
        emit ExchangeRateSet(initRate, exchangeRate());
        ```
    *   Here, we can see that the call returns
        ```Solidity
        return (FIX_SCALE_SQ + (stakeRate / 2)) / stakeRate;
        ```
    *   since `stakeRate` was updated to 0 before, the call will revert

### Impact and Likelihood

The likelihood of this issue is **LOW**. The impact seems somewhere between **HIGH** and **MEDIUM** since a necessary rebalance action can be DoSed until it is noticed and an action is taken. Considering that the issue is possible due to a broken invariant, the severity should be judged as **MEDIUM**.

### Recommendation

One way to fix the issue would be to enforce the invariant `if totalStakes == 0, then stakeRSR == 0`. This could be done by assuring that `amount` is not 0 in [`_mint`](https://github.com/code-423n4/2024-07-reserve/blob/main/contracts/p1/StRSR.sol#L842).

```diff
    function _mint(address account, uint256 amount) internal virtual {
        _notZero(account);
+       _notZero(amount);
        assert(totalStakes + amount < type(uint224).max);

        stakes[era][account] += amount;
        totalStakes += amount;

        emit Transfer(address(0), account, amount);
        _afterTokenTransfer(address(0), account, amount);
    }
```

Another mitigation could be to update the [`seizeRSR`](https://github.com/code-423n4/2024-07-reserve/blob/main/contracts/p1/StRSR.sol#L446-L449) function to update the `stakeRate` only if both `stakeRSR` and `totalStakes` are non-zero or update the `stakeRate` to `FIX_ONE` if either of these two is zero.

**[tbrent (Reserve) commented](https://github.com/code-423n4/2024-07-reserve-findings/issues/39#issuecomment-2310758715):**
 > This is a plausible issue. We would like to request a coded PoC from the warden, since it is about a very specific numeric case. 

**[cccz (judge) commented](https://github.com/code-423n4/2024-07-reserve-findings/issues/39#issuecomment-2317533058):**
 > Since the initial judging time is not enough to verify it, consider it valid first and keep open, and wait for the PoC from warden.<br>
> And may invalidate it without further proof.

**[akshatmittal (Reserve) commented](https://github.com/code-423n4/2024-07-reserve-findings/issues/39#issuecomment-2318327964):**
 > Just noting that we currently think this is _not_ possible but might be _plausible_ in super specific circumstances which is why we're requesting the PoC.

**[krikolkk (warden) commented](https://github.com/code-423n4/2024-07-reserve-findings/issues/39#issuecomment-2318605677):**
 > Hi @akshatmittal @tbrent - The PoC in the issue is wrong; however, the issue exists. Below I attach the updated PoC with a test proving the issue. Under those conditions `seizeRSR` will be dosed due to a broken protocol invariant.
> 
> <details>
> Let's assume the system becomes unhealthy, and the stakers will start unstaking their tokens in fear of an upcoming reset/seize. Then the following chain of action happens:
> 
> 1. The last staker unstakes everything but one token so `_payoutRewards` updates `stakeRSR`
> 2. Stake rate is below `5e17` - this can happen natuarally or forcefully (in our scenario everybody unstaked so we can influence it in some way)
> 3. `BackingManager` tries to seize RSR from the staking contract, but this transaction is frontran with another transaction in which
>   1. The last staker unstakes the last token
>   2. The last staker stakes 2 wei 
> 
> What will happen is that
> 
> 1. During the `unstake` [call](https://github.com/code-423n4/2024-07-reserve/blob/main/contracts/p1/StRSR.sol#L259):
>    - `_payoutRewards` is called. Since `totalStakes` is still above `1e18`, `stakeRSR` can be increased and become greater than `totalStakes`. 
>    - This will influence the new `stakeRate`. If this becomes less than `5e17`, the problem arises
> 2. During the `stake` [call](https://github.com/code-423n4/2024-07-reserve/blob/main/contracts/p1/StRSR.sol#L227):
>    - `payoutRewards` is skipped because it was already called in this block
>    - `newTotalStakes` in `mintStakes` is calculated as `(stakeRate * newStakeRSR) / FIX_ONE`, which translates to `(stakeRate * (stakeRSR + rsrAmount)) / FIX_ONE` which translates to `(499999999999999999 * (0 + 2)) / 1e18` resulting in 0, meaning 0 tokens are minted and `totalStakes` remains 0
>    - `stakeRSR` is increased by 2
>    - Note that `499999999999999999` is the greatest possible value of `stakeRate` when the issue arises
>    - in the end we can see that `totalStakes` is 0, and `stakeRSR` is 2 (note that this breaks [this assumption](https://github.com/code-423n4/2024-07-reserve/blob/main/contracts/p1/StRSR.sol#L619-L620))
> 3. Now we examine the important parts of the `seizeRSR` call
>    - `stakeRSRToTake` is set to `(2 * rsrAmount + (rsrBalance - 1)) / rsrBalance`, which will result in 1 every time the we are not seizing more than half of the total balance of the contract
>    - `stakeRSR` is therefore set to 1, and since it is non-zero, `stakeRate` is updated to `uint192((FIX_ONE_256 * totalStakes + (stakeRSR - 1)) / stakeRSR)`, which translates to `uint192((1e18 * 0 + (1 - 1)) / 1)` which comes to 0
>    - the rest of the call is not important until it comes to
>      ```Solidity
>      emit ExchangeRateSet(initRate, exchangeRate());
>      ```
>    - Here, we can see that the call returns
>      ```Solidity
>      return (FIX_SCALE_SQ + (stakeRate / 2)) / stakeRate;
>      ```
>    - since `stakeRate` was updated to 0 before, the call will revert here
> 
> The following test showcases the issue with different numbers:
> 
> ```TypeScript
> it.only("Unable to seize RSR", async () => {
>   const stakeAmt: BigNumber = bn("5000e18");
>   const unstakeAmt: BigNumber = bn("4999e18");
>   const one: BigNumber = bn("1e18");
>   const rewards: BigNumber = bn("100e18");
>   const seizeAmount: BigNumber = bn("2499e18");
> 
>   // 1. Stake
>   await rsr.connect(addr1).approve(stRSR.address, stakeAmt);
>   await stRSR.connect(addr1).stake(stakeAmt);
> 
>   // 2. Decrease stakeRate to ~5e17 - 1
>   await rsr.connect(owner).mint(stRSR.address, rewards);
>   await advanceToTimestamp((await getLatestBlockTimestamp()) + 1);
>   await stRSR.payoutRewards();
>   await advanceToTimestamp((await getLatestBlockTimestamp()) + 86400);
>   await stRSR.payoutRewards();
> 
>   // 3. Unstake everything but 1e18
>   await stRSR.connect(addr1).unstake(unstakeAmt);
>   await advanceToTimestamp((await getLatestBlockTimestamp()) + 172800);
> 
>   // 4. Unstake the last token then stake 2 wei
> 
>   // everything must happen in 1 tx thats why we deploy `SeizeAttacker`
>   const SeizeAttackerFactory = await ethers.getContractFactory("SeizeAttacker");
>   let seizeAttacker = await SeizeAttackerFactory.deploy();
> 
>   // transfer stRSR to the seize attacker so it can unstake
>   await stRSR.connect(addr1).transfer(seizeAttacker.address, one);
>   await rsr.connect(owner).mint(seizeAttacker.address, 2);
>   await seizeAttacker.doIt(stRSR.address, rsr.address, one);
> 
>   // 5. seize rsr fails
>   await setStorageAt(stRSR.address, 256, addr1.address); // set addr1 as backing manager so we can call seize rsr easily
>   await stRSR.connect(addr1).seizeRSR(seizeAmount);
> });
> ```
> 
> We will see that the test will fail with the following output
> 
> ```console
>   Error: VM Exception while processing transaction: reverted with panic code 0x12 (Division or modulo division by zero)
> ```
> </details>

**[akshatmittal (Reserve) commented](https://github.com/code-423n4/2024-07-reserve-findings/issues/39#issuecomment-2318618493):**
 > Hey @krikolkk, thanks for that. Can you please share the code for `SeizeAttacker` contract and replace the last call with impersonating `BackingManager` instead? (So I'm able to reproduce this)

**[krikolkk (warden) commented](https://github.com/code-423n4/2024-07-reserve-findings/issues/39#issuecomment-2318658821):**
 > @akshatmittal - mb, forgot about that.
> 
> <details>
> 
> ```Solidity
> // SPDX-License-Identifier: MIT
> pragma solidity ^0.8.19;
> 
> interface IStRSR {
>     function stake(uint256 rsrAmount) external;
>     function unstake(uint256 stakeAmount) external;
> }
> 
> interface RSR {
>     function approve(address who, uint256 amount) external;
> }
> 
> contract SeizeAttacker {
> 
>     function doIt(address stRSR,address rsr, uint amount) external {
>         // unstake
>         IStRSR(stRSR).unstake(amount);
>         // approve
>         RSR(rsr).approve(stRSR, 2);
>         // stake 1
>         IStRSR(stRSR).stake(2);
>     }
> 
> }
> ```
> 
> In the test we set `addr1` as backing manager so `addr1` can call the method, the test should work.
> </details>

**[akshatmittal (Reserve) commented](https://github.com/code-423n4/2024-07-reserve-findings/issues/39#issuecomment-2319046215):**
 > Accepted.
> 
> Specifically, want to point out that the following must be true:
> 1. Last staker in the pool.
> 2. `stakeRate` is \< `5e17 - 1`
> 3. Alone has \> `minTradeVolume` worth of RSR, or total drafts \> `minTradeVolume`. ([Acceptable Values](https://github.com/reserve-protocol/protocol/blob/468df052524e6181a723cd9bdd027add7a1cc4bb/docs/deployment-variables.md?plain=1#L25))
> 4. Able to frontrun the seize call.

**[krikolkk (warden) commented](https://github.com/code-423n4/2024-07-reserve-findings/issues/39#issuecomment-2320060974):**
 > @akshatmittal - the volume can be cumulated with other stakers who already unstaked. The main problem here is that we are breaking a protocol variant, as shown in the PoC, hence the code behaves unexpectedly.

**[Reserve mitigated](https://github.com/code-423n4/2024-09-reserve-mitigation?tab=readme-ov-file#findings-being-mitigated)**

**Status:** Mitigation confirmed. Full details in reports from [Bauchibred](https://github.com/code-423n4/2024-09-reserve-mitigation-findings/issues/3), [RadiantLabs](https://github.com/code-423n4/2024-09-reserve-mitigation-findings/issues/37) and [ether_sky](https://github.com/code-423n4/2024-09-reserve-mitigation-findings/issues/25).

***

## [[M-03] The default Governor Anastasius is unable to call `resetStakes`](https://github.com/code-423n4/2024-07-reserve-findings/issues/36)
*Submitted by [krikolkk](https://github.com/code-423n4/2024-07-reserve-findings/issues/36)*

The `StRSR` contract contains a function [`resetStakes`](https://github.com/code-423n4/2024-07-reserve/blob/main/contracts/p1/StRSR.sol#L490), which is used to reset the staking of a specific RToken system, when the stake rate becomes unsafe. When this happens, the `era` of the staking contract is incremented, which practically resets the `StRSR` token. Since this is a sensitive action, only governance can call this function.

The Reserve team provides a default and recommended `Governance` contract with `TimelockController`, which handles the proposal creation and execution. The contract also ensures that proposals created in a past era can not be queued or executed in the current era since the voting conditions can differ between eras. However due to this check, it is impossible for the `Governance` contract to call `resetStakes`, since the function would increment the era, and the following check whether the proposal was proposed in the same era would not hold and revert the transaction.

### Proof of Concept

The following test added to [ZZStRSR.tests.ts](https://github.com/code-423n4/2024-07-reserve/blob/main/test/ZZStRSR.test.ts) supports the issue:

<details>

```typescript
it.only("Impossible to reset stakes with Governor Anastasius", async () => {
  // Setup governance
  const ONE_DAY = 86400;
  const VOTING_DELAY = ONE_DAY;
  const VOTING_PERIOD = ONE_DAY * 3;
  const MIN_DELAY = ONE_DAY * 7;

  let GovernorFactory = await ethers.getContractFactory("Governance");
  let stRSRVotes = await ethers.getContractAt("StRSRP1Votes", stRSR.address);
  let TimelockFactory = await ethers.getContractFactory("TimelockController");
  let timelock = <TimelockController>(
    await TimelockFactory.deploy(MIN_DELAY, [], [], owner.address)
  );

  let governor = await GovernorFactory.deploy(
    stRSRVotes.address,
    timelock.address,
    VOTING_DELAY,
    VOTING_PERIOD, // voting period
    0, // threshold set to 0 just to showcase the issue
    0 // quorum percentage set to 0 just to showcase the issue
  );

  /////////////////////////////////////////
  ///                                   ///
  /// First step: update timelock roles ///
  ///                                   ///
  /////////////////////////////////////////

  const proposerRole = await timelock.PROPOSER_ROLE();
  const executorRole = await timelock.EXECUTOR_ROLE();
  const cancellerRole = await timelock.CANCELLER_ROLE();
  const adminRole = await timelock.TIMELOCK_ADMIN_ROLE();

  await timelock.grantRole(proposerRole, governor.address);
  await timelock.grantRole(executorRole, governor.address);
  await timelock.grantRole(cancellerRole, governor.address);
  await timelock.revokeRole(adminRole, owner.address);

  // Then we will update the owner to a new decentralized Governor Anastasius
  await main.connect(owner).grantRole(OWNER, governor.address);
  await main.connect(owner).renounceRole(OWNER, owner.address);

  //////////////////////////////////////////
  ///                                    ///
  /// Second step: MAKE THE RATES UNSAFE ///
  ///                                    ///
  //////////////////////////////////////////

  const stakeAmt: BigNumber = bn("1000e18");
  const addAmt1: BigNumber = bn("100e18");
  const addAmt2: BigNumber = bn("120e30");

  // Stake
  await rsr.connect(addr1).approve(stRSR.address, stakeAmt);
  await stRSR.connect(addr1).stake(stakeAmt);

  expect(await stRSR.exchangeRate()).to.equal(fp("1"));
  expect(await stRSR.totalSupply()).to.equal(stakeAmt);
  expect(await stRSR.balanceOf(addr1.address)).to.equal(stakeAmt);

  // Add RSR to decrease stake rate - still safe
  await rsr.connect(owner).transfer(stRSR.address, addAmt1);

  // Advance to the end of noop period
  await advanceToTimestamp((await getLatestBlockTimestamp()) + 1);
  await stRSR.payoutRewards();

  // Calculate payout amount
  const decayFn = makeDecayFn(await stRSR.rewardRatio());
  const addedRSRStake = addAmt1.sub(decayFn(addAmt1, 1)); // 1 round
  const newRate: BigNumber = fp(stakeAmt.add(addedRSRStake)).div(stakeAmt);

  // Payout rewards - Advance to get 1 round of rewards
  await setNextBlockTimestamp((await getLatestBlockTimestamp()) + 1);
  await expect(stRSR.payoutRewards()).to.emit(stRSR, "ExchangeRateSet");
  expect(await stRSR.exchangeRate()).to.be.closeTo(newRate, 1);
  expect(await stRSR.totalSupply()).to.equal(stakeAmt);
  expect(await stRSR.balanceOf(addr1.address)).to.equal(stakeAmt);

  // Add a large amount of funds - rate will be unsafe
  await rsr.connect(owner).mint(owner.address, addAmt2);
  await rsr.connect(owner).transfer(stRSR.address, addAmt2);

  // Advance to the end of noop period
  await setNextBlockTimestamp((await getLatestBlockTimestamp()) + 1);
  await stRSR.payoutRewards();

  // Payout rewards - Advance time - rate will be unsafe
  await setNextBlockTimestamp((await getLatestBlockTimestamp()) + 100);
  await expect(stRSR.payoutRewards()).to.emit(stRSR, "ExchangeRateSet");
  expect(await stRSR.exchangeRate()).to.be.gte(fp("1e6"));
  expect(await stRSR.exchangeRate()).to.be.lte(fp("1e9"));
  expect(await stRSR.totalSupply()).to.equal(stakeAmt);
  expect(await stRSR.balanceOf(addr1.address)).to.equal(stakeAmt);

  //////////////////////////////////////////////////////////////////////////////////////
  ///                                                                                ///
  /// Step 3: Now that the rates are unsafe, we can start a proposal to reset stakes ///
  /// We will have to delegate some votes in order for the proposal to succeed       ///
  ///                                                                                ///
  //////////////////////////////////////////////////////////////////////////////////////

  await stRSRVotes.connect(addr1).delegate(addr1.address);
  await advanceBlocks(2);

  // Proposal info
  let encodedFunctionCall =
    stRSRVotes.interface.encodeFunctionData("resetStakes");
  let proposalDescription = "Proposal #1 - Reset stakes";
  let proposalDescHash = ethers.utils.keccak256(
    ethers.utils.toUtf8Bytes(proposalDescription)
  );

  // Propose
  const proposeTx = await governor
    .connect(addr1)
    .propose(
      [stRSRVotes.address],
      [0],
      [encodedFunctionCall],
      proposalDescription
    );

  const proposeReceipt = await proposeTx.wait(1);
  const proposalId = proposeReceipt.events![0].args!.proposalId;

  // Proposal created
  expect(await governor.state(proposalId)).to.equal(ProposalState.Pending);

  // Advance time to start voting
  await advanceBlocks(VOTING_DELAY + 1);
  expect(await governor.state(proposalId)).to.equal(ProposalState.Active);

  await governor.connect(addr1).castVote(proposalId, 1);
  await advanceBlocks(1);

  // Advance time till voting is complete
  await advanceBlocks(VOTING_PERIOD + 1);
  expect(await governor.state(proposalId)).to.equal(ProposalState.Succeeded);

  // Queue proposal
  await governor
    .connect(addr1)
    .queue([stRSRVotes.address], [0], [encodedFunctionCall], proposalDescHash);

  // Check proposal state
  expect(await governor.state(proposalId)).to.equal(ProposalState.Queued);

  // Advance time required by timelock
  await advanceTime(MIN_DELAY + 1);
  await advanceBlocks(1);

  //////////////////////////////////////////////////////////////////////////////
  ///                                                                        ///
  /// The execution will revert because the era changes during the execution ///
  ///                                                                        ///
  //////////////////////////////////////////////////////////////////////////////

  await expect(
    governor
      .connect(addr1)
      .execute(
        [stRSRVotes.address],
        [0],
        [encodedFunctionCall],
        proposalDescHash
      )
  ).to.be.revertedWith("TimelockController: underlying transaction reverted");

  // We can see that the proposal is still queued
  expect(await governor.state(proposalId)).to.equal(ProposalState.Queued);
});

```

</details>

### Impact and Likelihood

The impact of this issue is **MEDIUM**, as under usual conditions, an impactful governance action would be unavailable. Since the probability of the stake rates being over/under max/min safe stake rate is low ([as per inline docs](https://github.com/code-423n4/2024-07-reserve/blob/main/contracts/p1/StRSR.sol#L489)), but the probability of the issue taking place is high, the likelihood of this issue is judged **MEDIUM**, hence the **MEDIUM** severity of this issue.

### Recommendation

Consider changing the order of `super._execute` and the `startedInSameEra` check in the [`Governance::_execute`](https://github.com/code-423n4/2024-07-reserve/blob/main/contracts/plugins/governance/Governance.sol#L143-L144) function:

```diff
    function _execute(
        uint256 proposalId,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(Governor, GovernorTimelockControl) {
+       require(startedInSameEra(proposalId), "new era");
        super._execute(proposalId, targets, values, calldatas, descriptionHash);
-       require(startedInSameEra(proposalId), "new era");
    }
```

**[akshatmittal (Reserve) confirmed](https://github.com/code-423n4/2024-07-reserve-findings/issues/36#issuecomment-2312334650)**

**[Reserve mitigated](https://github.com/code-423n4/2024-09-reserve-mitigation?tab=readme-ov-file#findings-being-mitigated)**

**Status:** Mitigation confirmed. Full details in reports from [Bauchibred](https://github.com/code-423n4/2024-09-reserve-mitigation-findings/issues/4), [ether_sky](https://github.com/code-423n4/2024-09-reserve-mitigation-findings/issues/26) and [RadiantLabs](https://github.com/code-423n4/2024-09-reserve-mitigation-findings/issues/15).

***

## [[M-04] Dutch auctions can fail to settle if any other collateral in the basket behaves unexpectedly](https://github.com/code-423n4/2024-07-reserve-findings/issues/32)
*Submitted by [RadiantLabs](https://github.com/code-423n4/2024-07-reserve-findings/issues/32)*

When a Dutch auction that originated from the backing manager receives a bid, it [calls](https://github.com/code-423n4/2024-07-reserve/blob/3f133997e186465f4904553b0f8e86ecb7bbacbf/contracts/plugins/trading/DutchTrade.sol#L222) `BackingManager.settleTrade()` to settle the auction immediately, which [attempts to chain](https://github.com/code-423n4/2024-07-reserve/blob/3f133997e186465f4904553b0f8e86ecb7bbacbf/contracts/p1/BackingManager.sol#L92) into another `rebalance()` call. This chaining is implemented using a try-catch block that attempts to catch out-of-gas errors.

However, this pattern is not safe because empty error data does not always indicate an out-of-gas error. Other types of errors also return no data, such as calls to empty addresses casted as contracts and revert / require statements with no error message.

The `rebalance()` function interacts with multiple external assets and performs several operations that can throw empty errors:

1.  In `basketsHeldBy()`, which calls `_quantity()`, which in turn calls `coll.refPerTok()` (this function should in theory [never revert](https://github.com/3docSec/2024-07-reserve/blob/main/docs/collateral.md#refpertok-reftok), but in case it interacts with the underlying ERC20, its implementation may have been upgraded to one that does).
2.  In `prepareRecollateralizationTrade()`, which calls `basketRange()`, which also calls `_quantity()`.
3.  In `tryTrade()` if a new rebalancing trade is indeed chained, which calls `approve()` on the token via `AllowanceLib.safeApproveFallbackToMax()`. This is a direct interaction with the token and hence cannot be trusted, especially if the possibility of [upgradeability](https://github.com/code-423n4/2024-07-reserve/tree/3f133997e186465f4904553b0f8e86ecb7bbacbf?tab=readme-ov-file#erc20-token-behaviors-in-scope) is considered.

If any of these operations result in an empty error, the auction settlement will fail. This can lead to the Dutch auction being unable to settle at a fair price.

Note: we have found [this](https://github.com/code-423n4/2023-06-reserve-findings/issues/8) finding pointing out the very same issue in a previous audit, but this report highlights a different root cause in where the error originates.

### Impact

Dutch auctions may fail to settle at the appropriate price or at all.

### Proof of Concept

1.  A Dutch auction is initiated for rebalancing collateral.
2.  After some time, a bidder attempts to submit a bid at fair market value.
3.  `BackingManager.settleTrade()` is called by the trade contract.
4.  The `rebalance()` function is called within the try-catch block.
5.  The underlying ERC-20 of one of the collateral assets in the basket has an empty revert clause that currently throws when one of its functions is called.
6.  The catch block receives an empty error and reverts the transaction.

### Recommended Mitigation Steps

Avoid usage of this pattern to catch OOG errors in any functions that cannot revert and may interact with external contracts. Instead, in such cases always employ the [`_reserveGas()`](https://github.com/code-423n4/2024-07-reserve/blob/3f133997e186465f4904553b0f8e86ecb7bbacbf/contracts/p1/AssetRegistry.sol#L253) pattern that was iterated on to mitigate previous findings ([1](https://github.com/code-423n4/2023-01-reserve-findings/issues/254), [2](https://github.com/code-423n4/2023-02-reserve-mitigation-contest-findings/issues/73), [3](https://github.com/code-423n4/2023-06-reserve-findings/issues/7)) with a similar root cause. We have found no other instances in which this applies.

**[akshatmittal (Reserve) disputed and commented](https://github.com/code-423n4/2024-07-reserve-findings/issues/32#issuecomment-2313014540):**
 > 1. This is a known issue.
> 2. The ERC20 upgrade to return _empty_ revert data on calling _any_ of its functions seems a little far fetched.

**[EV\_om (warden) commented](https://github.com/code-423n4/2024-07-reserve-findings/issues/32#issuecomment-2322924095):**
 > We do not think this should be considered a known issue either, unless it was accepted in a previous competition or pointed out in an audit.
> 
> An empty revert in one function of a collateral asset being characterized as far-fetched is a little surprising, considering findings were accepted in previous Reserve audits for the same situation but the token [reverting](https://github.com/code-423n4/2023-01-reserve-findings/issues/254), [consuming all gas](https://github.com/code-423n4/2023-02-reserve-mitigation-contest-findings/issues/73) and [consuming a specific amount of gas](https://github.com/code-423n4/2023-06-reserve-findings/issues/7).
> 
> All those findings concerned the ability to unregister a misbehaving asset, which we found to now be guaranteed. However, we found an asset misbehaving could also have the additional impact of preventing auctions from settling for a different asset. This same impact was accepted as valid for a different root cause [here](https://github.com/code-423n4/2023-06-reserve-findings/issues/8).
> 
> Again, an empty revert is nothing unusual and a simple `require()` with no error message will produce it.
> 
> We think this scenario is very much realistic and would like to kindly ask for it to be reassessed.

**[cccz (judge) commented](https://github.com/code-423n4/2024-07-reserve-findings/issues/32#issuecomment-2323610119):**
 > @akshatmittal and @tbrent - This seems to be a possible upgrade, please take a look, thanks!<br>
> > Again, an empty revert is nothing unusual and a simple require() with no error message will produce it.

**[akshatmittal (Reserve) commented](https://github.com/code-423n4/2024-07-reserve-findings/issues/32#issuecomment-2324874396):**
 > Looking back at this again @cccz.
> 
> The first two statements which hinge on `refPerTok` reverting are not valid since we _require_ `refPerTok` to not revert. If a collateral plugin does revert on it, it must be fixed and replaced. The third example however, the approve one, is where I can see the token revert causing issues.
> 
> I currently can not see any sane ERC20 reverting on an `approve` case with no message, however you may have better examples than I do. I still consider it highly unlikely, although if you do have examples to share I'll consider them.
> 
> And honestly, I currently do not see how to do better. For a little more context on that, we want settle to start a new auction, which is why that revert exists there, and we can't use the `_reserveGas` pattern here since the gas cost for `rebalance` is unbound.
> 
> RTokens are designed to be governance focused, and we already have the requirement for Governance to only include collaterals they absolutely trust (which is why you'd see all RTokens today use blue chip assets _only_).
> 
> If you absolutely _must_ consider it valid, I'd probably bring it down to Low/QA given the requirements here, but also looking for your thoughts.

**[cccz (judge) commented](https://github.com/code-423n4/2024-07-reserve-findings/issues/32#issuecomment-2325010694):**
 > @EV\_om - If there's no example, I'll invalidate it because the assumption isn't valid.

**[EV\_om (warden) commented](https://github.com/code-423n4/2024-07-reserve-findings/issues/32#issuecomment-2325096209):**
 > @cccz - [USDT](https://etherscan.io/token/0xdac17f958d2ee523a2206206994597c13d831ec7#code) and [BNB](https://etherscan.io/token/0xB8c77482e45F1F44dE1745F52C74426C631bDD52#code) throw empty errors on reverts within `approve()`, for instance.
> 
> These are the two largest market cap ERC-20 tokens in existence - again, this is not some theoretical esoteric behaviour but a realistic scenario.
> 
> There may not be a better approach if the gas cost of `rebalance()` is unbounded as you say @akshatmittal. But lack of an immediate mitigation does not invalidate the issue/make it QA.

**[akshatmittal (Reserve) commented](https://github.com/code-423n4/2024-07-reserve-findings/issues/32#issuecomment-2325120179):**
 > @EV\_om - Both of the examples you have mentioned throw on zero, which is a case handled within the code. (Also just saying here, BNB isn't technically a supported token for other reasons)
> 
> > this is not some theoretical esoteric behaviour but a realistic scenario.
> 
> Believe me, I'm not trying to say so. I'm really trying to find a realistic case where an _upgrade_ on the token makes it _regress_ in a basic ERC20 function.
> 
> And yeah, I'm also not saying not having a mitigation invalidates the issue, but rather that the protocol has ways of dealing with such specific things like wrapping the tokens, etc. We already wrap tokens that we don't like behaviours of, or tokens that have weird behaviours.
> 
> (Talking to cccz to accept this, just trying to get a better idea)

**[cccz (judge) commented](https://github.com/code-423n4/2024-07-reserve-findings/issues/32#issuecomment-2325140658):**
 > Although the likelihood is low, the assumed token satisfies acceptable upgradability, will upgrade it to Medium.


***

## [[M-05] Users can dodge losses due to StRSR era changes with instant operations](https://github.com/code-423n4/2024-07-reserve-findings/issues/21)
*Submitted by [RadiantLabs](https://github.com/code-423n4/2024-07-reserve-findings/issues/21)*

The StRSR contract implements an era-based wrapping of the `stakeRate` and `draftRate` exchange rates whenever these pass the maximum accepted value of `MAX_STAKE_RATE` and `MAX_DRAFT_RATE`; the effect of this action is that StRSR token holders see their balance reset (`stakeRate` reset) and/or all StRSR vesting withdraws are forgotten and the relative funds lost (`draftRate` reset).

From the code below, we can see that these two rates can be reset independently;

```Solidity
File: StRSR.sol
424:     function seizeRSR(uint256 rsrAmount) external {
---
440:         // Remove RSR from stakeRSR
441:         uint256 stakeRSRToTake = (stakeRSR * rsrAmount + (rsrBalance - 1)) / rsrBalance;
442:         stakeRSR -= stakeRSRToTake;
443:         seizedRSR = stakeRSRToTake;
444: 
445:         // update stakeRate, possibly beginning a new stake era
446:         if (stakeRSR != 0) {
447:             // Downcast is safe: totalStakes is 1e38 at most so expression maximum value is 1e56
448:             stakeRate = uint192((FIX_ONE_256 * totalStakes + (stakeRSR - 1)) / stakeRSR);
449:         }
450:         if (stakeRSR == 0 || stakeRate > MAX_STAKE_RATE) {
451:             seizedRSR += stakeRSR;
452:             beginEra();
453:         }
454: 
455:         // Remove RSR from draftRSR
456:         uint256 draftRSRToTake = (draftRSR * rsrAmount + (rsrBalance - 1)) / rsrBalance;
457:         draftRSR -= draftRSRToTake;
458:         seizedRSR += draftRSRToTake;
459: 
460:         // update draftRate, possibly beginning a new draft era
461:         if (draftRSR != 0) {
462:             // Downcast is safe: totalDrafts is 1e38 at most so expression maximum value is 1e56
463:             draftRate = uint192((FIX_ONE_256 * totalDrafts + (draftRSR - 1)) / draftRSR);
464:         }
465: 
466:         if (draftRSR == 0 || draftRate > MAX_DRAFT_RATE) {
467:             seizedRSR += draftRSR;
468:             beginDraftEra();
469:         }
```

... and we'd then argue that they will most likely happen at different times, at the very least because rewards contribute to the evolution of `stakeRate` only.

In the event only one of the two rates reaches the cap and undergoes a reset, stakers can dodge the bullet of collectivized losses, by:

*   sandwiching the `stakeRate` wrapping with `unstake` and `cancelUnstake` calls
*   sandwiching the `draftRate` wrapping with `cancelUnstake` and `unstake` calls

### Impact

Users can avoid the collectivization of rate wrapping losses, and artificially get a share of any RSR left in the StRSR contract.

This latter quantity may be considerable, because while unlikely, it's not impossible that the rate wrapping happens when little RSR is seized from an otherwise large RSR balance in the StRSR contract.

### Proof of Concept

Alice is an StRSR token holder:

*   she notices that a transaction will soon cause RSR to be seized and the `stakeRate` will wrap to 1.0
*   she immediately initiates an `unstake`, so her funds are moved to the drafts bucket
*   immediately after the transaction that wraps the `stakeRate`, she calls `cancelUnstake`
*   Alice lost only the pro-rata RSR that was seized (which may be minimal) while others lost everything

A similar sequence can be performed to avoid losses on funds that are being unstaked by instead calling `cancelUnstake` first and `unstake` later.

### Tools Used

Code review, Foundry

### Recommended Mitigation Steps

Consider wrapping both rates when at least one reaches the maximum.

**[tbrent (Reserve) acknowledged and commented](https://github.com/code-423n4/2024-07-reserve-findings/issues/21#issuecomment-2313071106):**
 > The wrapping occurs at the `MAX_STAKE_RATE` or `MAX_DRAFT_RATE`, ie 1e27. 
> 
> `resetStakes()` is available to governance above `MAX_SAFE_STAKE_RATE`, ie 1e24. 
> 
> StRSR is unstable between these bounds, but the risk of it occurring is assumed low enough to be not worth further mitigating. See: https://github.com/reserve-protocol/protocol/blob/72fc1f6e41da01e733c0a7e96cdb8ebb45bf1065/contracts/p1/StRSR.sol#L490
> 
> >///     The stake rate is unsafe when it is either too high or too low.
>     ///     There is the possibility of the rate reaching the borderline of being unsafe,
>     ///     where users won't stake in fear that a reset might be executed.
>     ///     A user may also grief this situation by staking enough RSR to vote against any reset.
>     ///     This standoff will continue until enough RSR is staked and a reset is executed.
>     ///     There is currently no good and easy way to mitigate the possibility of this situation,
>     ///     and the risk of it occurring is low enough that it is not worth the effort to mitigate.
> 
> The reported issue requires the same set of assumptions to get into this state, and then additional assumptions about the size of the next `seizeRSR()`. However, the impact trades off directly against the likelihood: the further the rate is away from the 1e27 bounds, the less likely this case is to occur. The closer to 1e27, the more clear it is to governance that they need to `resetStakes()`. And there are 3 orders of magnitude between 1e27 and 1e24 for this dynamic to play out. 
> 
> We would like to acknowledge the issue but dispute severity to Low, given it is a subset of a case already assumed low enough probability to not be worth mitigating. 

**[cccz (judge) decreased severity to Low](https://github.com/code-423n4/2024-07-reserve-findings/issues/21#issuecomment-2315861390)**

**[3docSec (warden) commented](https://github.com/code-423n4/2024-07-reserve-findings/issues/21#issuecomment-2318743268):**
 > Hi @cccz and @tbrent - the `require` statement in `resetStakes` makes this function a viable option to mitigate only the issue in case of `stakeRate` being close to wrapping, but does not help with the other scenario presented by this issue - that is when `draftRate` wraps.
> 
> ```Solidity
>     function resetStakes() external {
>         _requireGovernanceOnly();
>         require(
>             stakeRate <= MIN_SAFE_STAKE_RATE || stakeRate >= MAX_SAFE_STAKE_RATE,
>             "rate still safe"
>         );
> 
>         beginEra();
>         beginDraftEra();
>     }
> ```
> 
> Because `draftRate` normally goes only up with `seizeRSR`, and `stakeRate` instead goes up with `seizeRSR` but [also goes down with `_payoutRewards`](https://github.com/code-423n4/2024-07-reserve/blob/3f133997e186465f4904553b0f8e86ecb7bbacbf/contracts/p1/StRSR.sol#L621), it is still possible that `draftRate` grows close to `MAX_STAKE_RATE` while `stakeRate` is still below `MAX_SAFE_STAKE_RATE`. This scenario would prevent governance intervention, entering a situation where a `draftRate` wrapping alone is inevitable.
> 
> I would therefore ask you to reconsider the Medium severity, and potentially consider another mitigation option in allowing calls to `resetStakes` also when `draftRate` grows above `MAX_SAFE_STAKE_RATE`.

**[tbrent (Reserve) commented](https://github.com/code-423n4/2024-07-reserve-findings/issues/21#issuecomment-2319466907):**
 > That is a good point: `resetStakes()` cannot be used when it is the draft rate that is out of bounds. I think there is a change to the code to make there of some variety.
> 
> Still, in order for the below to be true:
> 
> > draftRate grows close to `MAX_STAKE_RATE` while stakeRate is still below `MAX_SAFE_STAKE_RATE`.
> 
> there must be at least 1000x historical appreciation of StRSR overall. This is an additional assumption beyond the initial assumptions of: (i) draftRate grows close to `MAX_STAKE_RATE` (requires consecutive nearly full-but-not-full seizures); (ii) can frontrun `seizeRSR()`.

**[cccz (judge) increased severity to Medium and commented](https://github.com/code-423n4/2024-07-reserve-findings/issues/21#issuecomment-2322910972):**
 > Based on the above conversation, users can frontrun resetStakes to avoid losses or get benefits. If this is correct, I would consider this issue to be low likelihood + high impact = Medium severity.

**[Reserve mitigated](https://github.com/code-423n4/2024-09-reserve-mitigation?tab=readme-ov-file#findings-being-mitigated)**

**Status:** Mitigation confirmed. Full details in reports from [ether_sky](https://github.com/code-423n4/2024-09-reserve-mitigation-findings/issues/27) and [Bauchibred](https://github.com/code-423n4/2024-09-reserve-mitigation-findings/issues/5).

***

## [[M-06] The time available for a canceled withdrawal should not impact future unstaking processes](https://github.com/code-423n4/2024-07-reserve-findings/issues/18)
*Submitted by [ether\_sky](https://github.com/code-423n4/2024-07-reserve-findings/issues/18), also found by [Bauchibred](https://github.com/code-423n4/2024-07-reserve-findings/issues/120)*

### Lines of Code

<https://github.com/code-423n4/2024-07-reserve/blob/3f133997e186465f4904553b0f8e86ecb7bbacbf/contracts/p1/StRSR.sol#L279><br>
<https://github.com/code-423n4/2024-07-reserve/blob/3f133997e186465f4904553b0f8e86ecb7bbacbf/contracts/p1/StRSR.sol#L658><br>
<https://github.com/code-423n4/2024-07-reserve/blob/3f133997e186465f4904553b0f8e86ecb7bbacbf/contracts/p1/StRSR.sol#L368>

### Impact

When `stakers` want to `unstake` their `StRSR`, they cannot `withdraw` `RSR` immediately.<br>
Instead, each `withdrawal` enters a `queue` and will become available after the `unstaking delay` period.<br>
This `queue` operates on a `FIFO` basis, meaning earlier `withdrawals` are processed before later ones.<br>
`Stakers` can also cancel their `withdrawals`, and the `RSR` will be `restaked` immediately.<br>
However, even canceled `withdrawals` can still impact future `withdrawal` requests.

### Proof of Concept

Suppose the current `unstakingDelay` is set to `1 day`, and a user decides to `unstake` some amount of `StRSR` at time `T` (`line 279`).

    function unstake(uint256 stakeAmount) external {
        address account = _msgSender();
        require(stakes[era][account] >= stakeAmount, "insufficient balance");
        _payoutRewards();
        _burn(account, stakeAmount);

        uint256 newStakeRSR = (FIX_ONE_256 * totalStakes + (stakeRate - 1)) / stakeRate;
        uint256 rsrAmount = stakeRSR - newStakeRSR;
        stakeRSR = newStakeRSR;

    279:    (uint256 index, uint64 availableAt) = pushDraft(account, rsrAmount);
    }

This request enters a `queue`, which we assume is empty at this point, making the `withdrawal` available at `T + 1 day` (`line 658`).

    function pushDraft(address account, uint256 rsrAmount)
        internal
        returns (uint256 index, uint64 availableAt)
    {
        CumulativeDraft[] storage queue = draftQueues[draftEra][account];
        index = queue.length;  // index = 0

        uint192 oldDrafts = index != 0 ? queue[index - 1].drafts : 0; // 0
        uint64 lastAvailableAt = index != 0 ? queue[index - 1].availableAt : 0; // 0
    658:    availableAt = uint64(block.timestamp) + unstakingDelay; // T + 1 day

        if (lastAvailableAt > availableAt) {
            availableAt = lastAvailableAt;
        }
        queue.push(CumulativeDraft(uint176(oldDrafts + draftAmount), availableAt));
    }

Now, let's assume the user `cancels` this `withdrawal` at time `T` for testing purposes. Instead of removing the `withdrawal` from the `queue`, we simply increase the `first available ID`, which is a good approach and is easy to implement (`line 368`).

    function cancelUnstake(uint256 endId) external {
        uint256 firstId = firstRemainingDraft[draftEra][account];
        CumulativeDraft[] storage queue = draftQueues[draftEra][account];
        if (endId == 0 || firstId >= endId) return;

        require(endId <= queue.length, "index out-of-bounds");

    368:    firstRemainingDraft[draftEra][account] = endId;
    }

Even though the `queue` technically still contains one item (the `canceled` `withdrawal` request), we can consider the `queue` empty in terms of available `withdrawals`.

Later, the owner updates the `unstakingDelay` to `1 hour`.<br>
The user attempts to `unstake` again, expecting to `withdraw` just `1 hour` later, which should be possible.<br>
However, the canceled `withdrawal` still impacts this new request.

In `line 654`, the `index` is `1` , and in `line 657`, `lastAvailableAt` is set to `T + 1 day` due to the canceled `withdrawal`.<br>
As a result, in `line 658`, the `availableAt` for the new `withdrawal` is calculated as `T + 1 hour`, but since this is less than `T + 1 day`, the new `withdrawal` is also pushed to be available `1 day` later.

    function pushDraft(address account, uint256 rsrAmount)
        internal
        returns (uint256 index, uint64 availableAt)
    {
        CumulativeDraft[] storage queue = draftQueues[draftEra][account];
    654:    index = queue.length;  // index = 1

        uint192 oldDrafts = index != 0 ? queue[index - 1].drafts : 0; // 0
    657:    uint64 lastAvailableAt = index != 0 ? queue[index - 1].availableAt : 0; // T + 1 day
    658:    availableAt = uint64(block.timestamp) + unstakingDelay; // T + 1 hour

        if (lastAvailableAt > availableAt) {
            availableAt = lastAvailableAt;
        }
        queue.push(CumulativeDraft(uint176(oldDrafts + draftAmount), availableAt));
    }

This situation is clearly unfair to the user.

The `availableAt` of `canceled withdrawals` should not be considered when determining the availability of new `withdrawals`.

Please add below test to the `test/ZZStRSR.test.ts`

<details>

```
    describe('PushDraft Test', () => {
      it('Should use current unstakingDelay', async () => {
        // old unstakingDelay is 1 day
        const oldUnstakingDelay = 3600 * 24
        await stRSR.connect(owner).setUnstakingDelay(oldUnstakingDelay)  
        const amount: BigNumber = bn('100e18')
        await rsr.connect(addr1).approve(stRSR.address, amount)
        await stRSR.connect(addr1).stake(amount)
      
        const draftEra = 1
        const availableAtOfFirst = await getLatestBlockTimestamp() + oldUnstakingDelay + 1
        /**
         * Unstaking request enter a queue, and withdrawal become available 1 day later
         */
        await expect(stRSR.connect(addr1).unstake(amount))
          .emit(stRSR, 'UnstakingStarted')
          .withArgs(0, draftEra, addr1.address, amount, amount, availableAtOfFirst)
      
        /**
         * Cancel the unstaking to eliminate any pending withdrawals
         */
        await stRSR.connect(addr1).cancelUnstake(1)
      
        // new unstakingDelay is 1 hour
        const newUnstakingDelay = 3600
        await stRSR.connect(owner).setUnstakingDelay(newUnstakingDelay)  
      
        await rsr.connect(addr2).approve(stRSR.address, amount)
        await stRSR.connect(addr2).stake(amount)
      
        const availableAtOfFirstOfUser2 = await getLatestBlockTimestamp() + newUnstakingDelay + 1
        /**
         * Unstaking request enter a queue, and withdrawal become available 1 hour later for a second user
         */
        await expect(stRSR.connect(addr2).unstake(amount))
          .emit(stRSR, 'UnstakingStarted')
          .withArgs(0, draftEra, addr2.address, amount, amount, availableAtOfFirstOfUser2)
      
        /**
         * Although the first unstaking was canceled, its available time still impacts subsequent unstaking requests
         */
        await expect(stRSR.connect(addr1).unstake(amount))
          .emit(stRSR, 'UnstakingStarted')
          .withArgs(1, draftEra, addr1.address, amount, amount, availableAtOfFirst)
      })
    })
```

</details>

### Recommended Mitigation Steps

    function pushDraft(address account, uint256 rsrAmount)
        internal
        returns (uint256 index, uint64 availableAt)
    {
        CumulativeDraft[] storage queue = draftQueues[draftEra][account];
        index = queue.length;  

        uint192 oldDrafts = index != 0 ? queue[index - 1].drafts : 0; 
        
    -    uint64 lastAvailableAt = index != 0 ? queue[index - 1].availableAt : 0; 
    +    uint64 lastAvailableAt = index != 0 && firstRemainingDraft[draftEra][account] < index ? queue[index - 1].availableAt : 0; 

        availableAt = uint64(block.timestamp) + unstakingDelay; 

        if (lastAvailableAt > availableAt) {
            availableAt = lastAvailableAt;
        }
        queue.push(CumulativeDraft(uint176(oldDrafts + draftAmount), availableAt));
    }

**[akshatmittal (Reserve) commented](https://github.com/code-423n4/2024-07-reserve-findings/issues/18#issuecomment-2313004127):**
 > Issue confirmed.
> 
> Although, want to downgrade to Low given the requirements, actions and impact.

**[cccz (judge) decreased severity to Low and commented](https://github.com/code-423n4/2024-07-reserve-findings/issues/18#issuecomment-2315894925):**
 > Considering the low likelihood (owner reduces unstakingDelay, user cancels withdrawals before that) and the earlier the cancellation, the lower the impact, it will be downgraded to Low.

**[ether\_sky (warden) commented](https://github.com/code-423n4/2024-07-reserve-findings/issues/18#issuecomment-2319565858):**
 > Hi @cccz - thanks for your review.
> 
> Let me clarify the `impact` and `likelihood` again.<br>
> As seen in the code below, the `minimum unstaking delay` is `2 minutes`, and the `maximum` is `1 year`. There's a significant difference between these two values.
> ```
> uint48 private constant MIN_UNSTAKING_DELAY = 60 * 2; // {s} 2 minutes
> uint48 private constant MAX_UNSTAKING_DELAY = 60 * 60 * 24 * 365; // {s} 1 year
> ```
> 
> Suppose the current `unstaking delay` is set to the `1 year`.<br>
> All `stakers` are operating under this `delay` now.<br>
> For various reasons, the `admin` decides to reduce the `unstaking delay` to a shorter period, say `1 month`.<br>
> `Stakers` will realize they can `withdraw` their funds after `1 month` instead of `1 year`.<br>
> They can cancel their existing `withdrawal requests` and attempt to `unstake` again.<br>
> However, the original `1-year` `delay` still applies to all `stakers`, meaning they cannot `withdraw` their funds after just `1 month`—even if they `cancel` their old `withdrawals`.<br>
> Their funds remain `locked` for `1 year`.
> 
> > Considering the low likelihood (owner reduces unstakingDelay, user cancels withdrawals before that) and the earlier the cancellation, the lower the impact, it will be downgraded to Low
> 
> Regarding the `likelihood`, users do not need to `cancel` their `withdrawals` before the owner changes the `unstaking delay`. Even if they `cancel` their `withdrawals` anytime after the `delay` is changed, the old `delay` still impacts all `stakers`.
> 
> As for the `impact`, this situation results in users' `funds` being locked and creates a DoS issue.
> 
> Given these points, I believe the `impact` and `likelihood` are at least `medium`. I would appreciate it if you could reconsider this issue.

**[cccz (judge) increased severity to Medium and commented](https://github.com/code-423n4/2024-07-reserve-findings/issues/18#issuecomment-2322722550):**
 > When the owner reduces unstakingDelay, the user will not be able to apply the latest unstakingDelay even if they cancel the previous withdrawal.<br>
> If this is correct, I tend to raise it to Medium.

**[Reserve mitigated](https://github.com/code-423n4/2024-09-reserve-mitigation?tab=readme-ov-file#findings-being-mitigated)**

**Status:** Mitigation confirmed. Full details in reports from [Bauchibred](https://github.com/code-423n4/2024-09-reserve-mitigation-findings/issues/6), [ether_sky](https://github.com/code-423n4/2024-09-reserve-mitigation-findings/issues/28) and [RadiantLabs](https://github.com/code-423n4/2024-09-reserve-mitigation-findings/issues/22).

***

## [[M-07] The `tradeEnd` in `BackingManager` isn't updating correctly](https://github.com/code-423n4/2024-07-reserve-findings/issues/6)
*Submitted by [ether\_sky](https://github.com/code-423n4/2024-07-reserve-findings/issues/6), also found by [RadiantLabs](https://github.com/code-423n4/2024-07-reserve-findings/issues/119) and [stuart\_the\_minion](https://github.com/code-423n4/2024-07-reserve-findings/issues/104)*

### Lines of code

<https://github.com/code-423n4/2024-07-reserve/blob/3f133997e186465f4904553b0f8e86ecb7bbacbf/contracts/p1/BackingManager.sol#L114><br>
<https://github.com/code-423n4/2024-07-reserve/blob/3f133997e186465f4904553b0f8e86ecb7bbacbf/contracts/p1/BackingManager.sol#L166>

### Impact

In the `BackingManager`, we use the `tradeEnd` value for each type of `trade` to prevent next `auction` from occurring within the same block. We can find a comment in the code explaining this in `line 114`.

    function rebalance(TradeKind kind) external nonReentrant {
        // DoS prevention:
    114:    // unless caller is self, require that the next auction is not in same block
        require(
            _msgSender() == address(this) || tradeEnd[kind] < block.timestamp,
            "already rebalancing"
        );

This approach works correctly for `Batch auctions`. However, with `Dutch auctions`, the `tradeEnd` value can inadvertently block the next `auction` from starting for a certain period.

### Proof of Concept

The `maximum auction length` can be up to `1 week`.

    uint48 public constant MAX_AUCTION_LENGTH = 60 * 60 * 24 * 7; // {s} max valid duration, 1 week

And the `minimum warm-up period` in the `BasketHandler` is `1 minute`.

    uint48 public constant MIN_WARMUP_PERIOD = 60; // {s} 1 minute

Suppose a `Dutch auction` is created in the `BackingManager` with a length of `1 week` (`7 days`), starting at timestamp `T`. The `tradeEnd` for this `auction type` is set to `T + 7 days` in `line 166`.

    function rebalance(TradeKind kind) external nonReentrant {
    155:    if (doTrade) {

    165:	    ITrade trade = tryTrade(kind, req, prices);
    166:	    tradeEnd[kind] = trade.endTime(); // {s}

    168:	}
    }

Now, let's consider a scenario where one of the `assets` in the `basket` temporarily falls into an `IFFY` status. At this point, the current status of the `basket` is also `IFFY` (`line 323~325`).

    function status() public view returns (CollateralStatus status_) {
    	uint256 size = basket.erc20s.length;
        if (disabled || size == 0) return CollateralStatus.DISABLED;
        
        for (uint256 i = 0; i < size; ++i) {
            CollateralStatus s = assetRegistry.toColl(basket.erc20s[i]).status();
    323:        if (s.worseThan(status_)) {
    324:            if (s == CollateralStatus.DISABLED) return CollateralStatus.DISABLED;
    325:            status_ = s;
            }
        }
    }

The `auction` is settled one day later, triggering the `rebalance` function (`line 92`).

    function settleTrade(IERC20 sell) public override(ITrading, TradingP1) returns (ITrade trade) {
        delete tokensOut[sell];
        trade = super.settleTrade(sell); // nonReentrant

        if (_msgSender() == address(trade)) {        
    92:        try this.rebalance(trade.KIND()) {} catch (bytes memory errData) {
            }
        }
    }

The check at `line 116` passes because the caller is the `BackingManager` itself. However, the `BasketHandler` status is still `IFFY`, meaning it isn't ready for a new `auction`. As a result, the check at `line 121` prevents the next `auction` from being created.

    function rebalance(TradeKind kind) external nonReentrant {
        requireNotTradingPausedOrFrozen();
        assetRegistry.refresh();

        require(
    116:        _msgSender() == address(this) || tradeEnd[kind] < block.timestamp,
            "already rebalancing"
        );

        require(tradesOpen == 0, "trade open");
        
    121:    require(basketHandler.isReady(), "basket not ready");
        
        require(block.timestamp >= basketHandler.timestamp() + tradingDelay, "trading delayed");
    }

The `tradeEnd` is still set to `T + 7 days` and the current time is now `T + 1 day`.

After another day, the `asset`'s status recovers to `SOUND`, and the `BasketHandler` status updates to `SOUND` as well.<br>
After the `warm-up period` (`1 minute` in our scenario), the `BasketHandler` is ready, and the time is now `T + 2 days + 1 minute`.<br>
At this point, we want to create a new `Dutch auction` for `rebalancing`.<br>
However, we can't create the next `Dutch auction` until `T + 7 days` due to the existing `tradeEnd`.

This delay clearly poses an issue.

### Recommended Mitigation Steps

```
    function settleTrade(IERC20 sell) public override(ITrading, TradingP1) returns (ITrade trade) {
            delete tokensOut[sell];
            trade = super.settleTrade(sell); // nonReentrant

            if (_msgSender() == address(trade)) {
                try this.rebalance(trade.KIND()) {} catch (bytes memory errData) {
                    if (errData.length == 0) revert(); // solhint-disable-line reason-string
                }

    +			tradeEnd[kind] = uint48(block.timestamp);

            }
        }
    }
```

**[akshatmittal (Reserve) confirmed, but disagreed with severity and commented](https://github.com/code-423n4/2024-07-reserve-findings/issues/6#issuecomment-2310820950):**
 > We'd like to bump this down to Low.
> 
> This is an issue, although does not impact protocol availability. The protocol can still function as expected using the other trading methods.

**[cccz (judge) commented](https://github.com/code-423n4/2024-07-reserve-findings/issues/6#issuecomment-2317945795):**
 > After reconsidering the issue, I think this should be valid Medium. It indeed affects the availability of the protocol, which meets the Medium severity.

**[tbrent (Reserve) commented](https://github.com/code-423n4/2024-07-reserve-findings/issues/6#issuecomment-2319485561):**
 > The issue can only impact DutchTrade because it is the only KIND that can have auctions that end before the endTime. 
> 
> I only see the availability of the protocol being impacted if the GnosisTrade' `reportViolation()` triggers, which would ultimately be the real cause of the loss of availability. GnosisTrade is supposed to be the fallback mechanism for trading. 
> 
> Possibly relevant: the notions of disabling in the Broker are very different for dutch trade and batch trade:
> - in dutch trades it is intended to detect if the protocol is trading off bad pricing data, since a dutch trade necessarily involves an assumption about the highest possible price. This is possible to trigger intentionally by burning \$. 
> - in batch trades it is intended to detect if EasyAuction goes beyond the worst-case min buy amounts. Similar to if a Uniswap swap violated slippage constraints, it should not happen. This should not be possible to trigger intentionally by burning \$.

**[ether\_sky (warden) commented](https://github.com/code-423n4/2024-07-reserve-findings/issues/6#issuecomment-2319567307):**
 > Thanks for your reveiw.
> 
> There are only two types of `trades`.<br>
> Because of this issue, `Dutch auctions` cannot occur for up to one week.<br>
> In some cases, `Dutch auctions` could be more efficient than `Batch trades`, but we are required to use `Batch trades` instead.
> 
> Additionally, as the sponsor described, `Batch trades` can be paused due to `reportViolation()`.<br>
> In such cases, this issue could have a significant impact.
> 
> Therefore, I believe this issue deserves a Medium severity based on its impact and likelihood.

**[cccz (judge) commented](https://github.com/code-423n4/2024-07-reserve-findings/issues/6#issuecomment-2321463045):**
 > Yes, as warden said, Dutch auctions being unavailable for a period of time is a concern.

**[akshatmittal (Reserve) commented](https://github.com/code-423n4/2024-07-reserve-findings/issues/6#issuecomment-2321503978):**
 > @cccz - Let me clarify what @tbrent is trying to say.
> 
> Batch Auctions are always available, and the whole reason they exist is for scenarios like this. The key about `reportViolation` for Gnosis Trade is that it checks for an EasyAuction protocol invariant, and nothing else. That is why it's the "backup" trading method.
> 
> Dutch Auctions and Batch Auctions have different characteristics from a what-happens-when perspective, but similar characteristics from a competition and pricing perspective. Yes, Dutch Auctions make it more efficient for the participants, which is why it exists, but it's not something that the protocol entirely depends on.
> 
> Unavailability of Dutch Auction _does_ not mean the protocol is at risk or is "unavailable", which is why we disable Dutch Auctions in many more conditions than Batch Auctions. Keep in mind that early versions of the protocol did not even have Dutch Trade to begin with.
> 
> That said, we'll leave it to you to decide here, we are internally considering it a low severity issue.

**[ether\_sky (warden) commented](https://github.com/code-423n4/2024-07-reserve-findings/issues/6#issuecomment-2321527000):**
 > Hi @akshatmittal - thanks for your comment.
> 
> I understood all your points. However, how can auditors know whether the `Dutch Auctions` is not important? The only thing which we could find is that there are only 2 types of auctions and one of them can be unavailable for some periods and each auctions can be paused due to `reportViolation` functionality.
> 
> Anyway, I will respect judge's decision.
> 
> Thanks again.

**[Reserve mitigated](https://github.com/code-423n4/2024-09-reserve-mitigation?tab=readme-ov-file#findings-being-mitigated)**

**Status:** Mitigation confirmed. Full details in reports from [RadiantLabs](https://github.com/code-423n4/2024-09-reserve-mitigation-findings/issues/17), [ether_sky](https://github.com/code-423n4/2024-09-reserve-mitigation-findings/issues/29) and [Bauchibred](https://github.com/code-423n4/2024-09-reserve-mitigation-findings/issues/7).

***

# Low Risk and Non-Critical Issues

For this audit, 12 reports were submitted by wardens detailing low risk and non-critical issues. The [report highlighted below](https://github.com/code-423n4/2024-07-reserve-findings/issues/34) by **RadiantLabs** received the top score from the judge.

*The following wardens also submitted reports: [Bauchibred](https://github.com/code-423n4/2024-07-reserve-findings/issues/111), [Shield](https://github.com/code-423n4/2024-07-reserve-findings/issues/108), [ether\_sky](https://github.com/code-423n4/2024-07-reserve-findings/issues/10), [0x52](https://github.com/code-423n4/2024-07-reserve-findings/issues/64), [SUPERMAN\_I4G](https://github.com/code-423n4/2024-07-reserve-findings/issues/113), [Agontuk](https://github.com/code-423n4/2024-07-reserve-findings/issues/110), [PolarizedLight](https://github.com/code-423n4/2024-07-reserve-findings/issues/109), [Rhaydden](https://github.com/code-423n4/2024-07-reserve-findings/issues/107), [DanielArmstrong](https://github.com/code-423n4/2024-07-reserve-findings/issues/89), [krikolkk](https://github.com/code-423n4/2024-07-reserve-findings/issues/43), and [Aamir](https://github.com/code-423n4/2024-07-reserve-findings/issues/11).*

## [L-01] Asymmetric decay of Asset saved priced distorts average price

### Links to affected code

https://github.com/code-423n4/2024-07-reserve/blob/main/contracts/plugins/assets/Asset.sol#L150-L163

### Description

The Asset contract implements a graceful fallback for being able to provide underlying asset prices when the upstream oracle is unreachable.

This fallback uses the last known price, but artificially widens its range (`low-high`) to offset the uncertainty over the stale price.

The math of how this offset is done is implemented with this code;
```Solidity
File: Asset.sol
150:                 // Decay _high upwards to 3x savedHighPrice
151:                 // {UoA/tok} = {UoA/tok} * {1}
152:                 _high = savedHighPrice.safeMul(
153:                     FIX_ONE + MAX_HIGH_PRICE_BUFFER.muluDivu(delta - decayDelay, priceTimeout),
154:                     ROUND
155:                 ); // during overflow should not revert
156: 
157:                 // if _high is FIX_MAX, leave at UNPRICED
158:                 if (_high != FIX_MAX) {
159:                     // Decay _low downwards from savedLowPrice to 0
160:                     // {UoA/tok} = {UoA/tok} * {1}
161:                     _low = savedLowPrice.muluDivu(decayDelay + priceTimeout - delta, priceTimeout);
162:                     // during overflow should revert since a FIX_MAX _low breaks everything
163:                 }
```

We can see that when the decay starts (`delta == decayDelay`), the saved `high/low` readings are returned unchanged; then they start diverging linearly: at the end of the decay (left limit of `delta == decayDelay + priceTimeout`) `low` reaches `0` and `high` is scaled up by a multiplier of `FIX_ONE + MAX_HIGH_PRICE_BUFFER`, that is 3x its cached value.

Referring to [this chart](https://github-production-user-asset-6210df.s3.amazonaws.com/145972240/357833152-d4a42618-e03c-4f9b-ae95-61bb77bbd224.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAVCODYLSA53PQK4ZA%2F20240911%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20240911T223748Z&X-Amz-Expires=300&X-Amz-Signature=71d369476874c7a35ef010db4a8a0c486a4f6ceba2e246eeeeb8862cea6c1382&X-Amz-SignedHeaders=host&actor_id=0&key_id=0&repo_id=0), because the two values - `low` (blue)  and `high` (red) - diverge with a different slope, their average (`(low + high) / 2`, green) also varies over time and increases.

While this is not an issue for the Asset itself which doesn't directly combine the two values with an average, it can be for downstream contracts that may do.

Consider changing `MAX_HIGH_PRICE_BUFFER` to `FIX_ONE` instead.

## [L-02] "Flash" upgrade can be abused to create rigged but honest-looking RToken contracts

### Links to affected code

https://github.com/code-423n4/2024-07-reserve/blob/3f133997e186465f4904553b0f8e86ecb7bbacbf/contracts/p1/Main.sol#L111-L150

### Description

The Main contract offers the possibility to upgrade Main and Component implementations, fetching the target addresses from an external `versionRegistry` provider.

Because the Deployer doesn't set `versionRegistry` but let the contract admin provide it, and this entity can't always be trusted as it's specified in the permissionless `Deployer.deploy` function, the contract upgrade system can be abused to achieve a large variety of deviations from its intended behavior by:
- setting custom implementations
- tampering with the storage of all contracts (including balances and/or settings to bypass `init` sanity checks)
- restoring the contracts in a state that looks legitimate with proper implementations and governance

All of the above can be achieved in one single transaction (hence the "Flash upgrade" term used above), possibly to be bundled with the contract creation or buried in a long list of spammy interactions to lower the chances of detection; after a moderately sophisticated attack like [the one presented in PoC](https://gist.github.com/3docSec/1cf7037b38f72719326f0f59d3f787f2) there can be no signs of past wrongdoing in the result of any of the RToken contracts' getters.

Consider having the Deployer set `Main.versionRegistry` at RToken deployment time to enforce continued use of trusted code.

## [L-03] Prime basket weights are not properly validated

### Links to affected code

https://github.com/code-423n4/2024-07-reserve/blob/3f133997e186465f4904553b0f8e86ecb7bbacbf/contracts/p1/BasketHandler.sol#L264

### Description

When the Governance sets the prime basket compositions, for each of the provided collaterals, it is allowed to specify any target amount between `1` and `MAX_TARGET_AMT` (L264):
```Solidity
File: BasketHandler.sol
260:         for (uint256 i = 0; i < erc20s.length; ++i) {
261:             // This is a nice catch to have, but in general it is possible for
262:             // an ERC20 in the prime basket to have its asset unregistered.
263:             require(assetRegistry.toAsset(erc20s[i]).isCollateral(), "erc20 is not collateral");
264:             require(0 < targetAmts[i] && targetAmts[i] <= MAX_TARGET_AMT, "invalid target amount");
265: 
266:             config.erc20s.push(erc20s[i]);
267:             config.targetAmts[erc20s[i]] = targetAmts[i];
268:             names[i] = assetRegistry.toColl(erc20s[i]).targetName();
269:             config.targetNames[erc20s[i]] = names[i];
270:         }
```

This check is however insufficient because excessively low values of `targetAmt`, like `1`, would likely cause overflows in the code that translates balances to assets / baskets like the BasketHandler.basketsHeldBy function.

Consider enforcing the [range specified in the acceptable values for prime basket weights](https://github.com/code-423n4/2024-07-reserve/blob/3f133997e186465f4904553b0f8e86ecb7bbacbf/docs/solidity-style.md?plain=1#L105), at the very least by requiring `targetAmts` to be `1e-6 (D18)` or more instead of the `1e-18 (D18)` or more that is currently allowed.

## [L-04] RToken issuance/redemption throttles can be monopolized by Bundlers and Batchers

### Links to affected code

https://github.com/code-423n4/2024-07-reserve/blob/3f133997e186465f4904553b0f8e86ecb7bbacbf/contracts/p1/RToken.sol#L121-L122<br>
https://github.com/code-423n4/2024-07-reserve/blob/3f133997e186465f4904553b0f8e86ecb7bbacbf/contracts/p1/RToken.sol#L199-L200<br>
https://github.com/code-423n4/2024-07-reserve/blob/3f133997e186465f4904553b0f8e86ecb7bbacbf/contracts/p1/RToken.sol#L277-L278<br>

### Description

When the RToken issuance and redemption are close to their limits, every upcoming issuance and redemption creates opportunity for a new operation in opposite direction to happen in the form of restored amount available for redemption or issuance respectively.

This means that actors that can control the ordering of transactions, and/or when a transaction is executed, like MEV bundlers and gasless transaction batchers, will have the upper hand on using these available amounts, potentially monopolizing them for themselves.

We don't have a suggested mitigation for the contracts in the scope, but we'd rather issue a recommendation for users to use private mempools and avoid gasless transactions for operations involving RToken issuance and redemption.

## [L-05] Broker accepts `batchAuctionLength` and `dutchAuctionLength` to be both `0`

### Links to affected code

https://github.com/code-423n4/2024-07-reserve/blob/3f133997e186465f4904553b0f8e86ecb7bbacbf/contracts/p1/Broker.sol#L199<br>
https://github.com/code-423n4/2024-07-reserve/blob/3f133997e186465f4904553b0f8e86ecb7bbacbf/contracts/p1/Broker.sol#L221

### Description

When `Broker` is initialized, and later re-configured via `governance` calls, it validates the `batchAuctionLength` and `dutchAuctionLength` given parameters individually:

```Solidity
File: Broker.sol
073:     function init(
---
080:     ) external initializer {
---
101:         setBatchAuctionLength(batchAuctionLength_);
102:         setDutchAuctionLength(dutchAuctionLength_);
103:     }
---
197:     function setBatchAuctionLength(uint48 newAuctionLength) public governance {
198:         require(
199:             newAuctionLength == 0 ||
200:                 (newAuctionLength >= MIN_AUCTION_LENGTH && newAuctionLength <= MAX_AUCTION_LENGTH),
201:             "invalid batchAuctionLength"
202:         );
203:         emit BatchAuctionLengthSet(batchAuctionLength, newAuctionLength);
204:         batchAuctionLength = newAuctionLength;
205:     }
---
219:     function setDutchAuctionLength(uint48 newAuctionLength) public governance {
220:         require(
221:             newAuctionLength == 0 ||
222:                 (newAuctionLength >= MIN_AUCTION_LENGTH && newAuctionLength <= MAX_AUCTION_LENGTH),
223:             "invalid dutchAuctionLength"
224:         );
225:         emit DutchAuctionLengthSet(dutchAuctionLength, newAuctionLength);
226:         dutchAuctionLength = newAuctionLength;
227:     }
```

It does however not validate the situation when they are both provided as `0`. This is a situation that is not admissible because in this case, no auction can be created and a BasketManager can't open recollateralization trades.

Consider adding additional checks in `setBatchAuctionLength` and `setDutchAuctionLength` to prevent setting both to `0`.

## [L-06] `PermitLib` uses two different ERC1271 implementations for the same call

### Links to affected code

https://github.com/code-423n4/2024-07-reserve/blob/3f133997e186465f4904553b0f8e86ecb7bbacbf/contracts/libraries/Permit.sol#L17

### Description

PermitLib offers the `requireSignature` function, which calls `isValidSignature` if `owner` is a contract, and uses OZ's `isValidSignatureNow` otherwise.

If we look at [the `isValidSignatureNow` implementation of the imported OZ version](https://github.com/OpenZeppelin/openzeppelin-contracts-upgradeable/blob/2d081f24cac1a867f6f73d512f2022e1fa987854/contracts/utils/cryptography/SignatureCheckerUpgradeable.sol#L28), however, we can see that this, too, has a fallback call to `IERC1271.isValidSignature`.

The `if isContract` branch in `requireSignature` is therefore useless because it's redundant with the other, more standard, branch and we therefore recommend removing it.

## [L-07] `VersionRegistry.latestVersion()` does not support semantic versioning

### Links to affected code

https://github.com/code-423n4/2024-07-reserve/blob/3f133997e186465f4904553b0f8e86ecb7bbacbf/contracts/registry/VersionRegistry.sol#L54

### Description

From the [version history of the Reserve protocol](https://github.com/reserve-protocol/protocol/tags) it appears that the protocol is using semantic versioning or a similar alternative.

This seems a use case that does not fit well with how `VersionRegistry.latestVersion` is updated: every time a new version is registered on `VersionRegistry`,  `latestVersion` will point to that version.

In the event that the protocol releases `4.0.0` and shortly after `3.4.2`, then `latestVersion` will incorrectly point to `3.4.2`.

Consider adding a `boolean` flag to the `registerVersion` function, allowing the caller to specify whether `latestVersion` should be updated or not.

## [L-08] `DutchTrade.bidWithCallback()` does not send back excess tokens

### Links to affected code

https://github.com/code-423n4/2024-07-reserve/blob/3f133997e186465f4904553b0f8e86ecb7bbacbf/contracts/plugins/trading/DutchTrade.sol#L260

### Description

`DutchTrade.bidWithCallback` allows for bidding with a callback hook that allows the bidder to swap the bought tokens for the sold tokens.

After the callback exits, the function checks that enough tokens are provided:

```Solidity
File: DutchTrade.sol
257:         uint256 balanceBefore = buy.balanceOf(address(this)); // {qBuyTok}
258:         IDutchTradeCallee(bidder).dutchTradeCallback(address(buy), amountIn, data);
259:         require(
260:             amountIn <= buy.balanceOf(address(this)) - balanceBefore,
261:             "insufficient buy tokens"
262:         );
```

However, if extra tokens are given, the function does not return the extras to the caller. Consider adding a check to return extra tokens if any are provided

## [L-09] Missing check to avoid circular dependencies among RTokens

### Links to affected code

https://github.com/code-423n4/2024-07-reserve/blob/3f133997e186465f4904553b0f8e86ecb7bbacbf/contracts/p1/BasketHandler.sol#L166

### Description

When BasketHandler switches basket to new reference amounts, it calls `trackStatus()`:

```Solidity
File: BasketHandler.sol
158:     function refreshBasket() external {
159:         assetRegistry.refresh();
160: 
161:         require(
162:             main.hasRole(OWNER, _msgSender()) ||
163:                 (lastStatus == CollateralStatus.DISABLED && !main.tradingPausedOrFrozen()),
164:             "basket unrefreshable"
165:         );
166:         _switchBasket();
167: 
168:         trackStatus();
169:     }
```

This call sequence would not call the scenario when there is a circular dependency between RTokens, for example: 
- RTokenA has RTokenB as collateral
- RTokenB governance is is unaware of their token being a collateral in RTokenA
- RTokenB adds RTokenA as collateral

At this point, price retrieval of either collateral would fail because of an infinite recursion.<br>
While the RTokenB governance action can be seen as a mistake, RTokenA is affected too without any mistake made by its governance.

Consider adding a `price()` call after `trackStatus()` to trigger a failure in the above-mentioned case.

## [L-10] `StRSRVotes.delegateBySig()` misses check for delegation to happen in the era intended by the signer

### Links to affected code

https://github.com/code-423n4/2024-07-reserve/blob/3f133997e186465f4904553b0f8e86ecb7bbacbf/contracts/p1/StRSRVotes.sol#L176

### Description

The `StRSRVotes.delegateBySig()` function allows a signer to delegate voting power to a designed delegate via a gasless call.

If we look at the logic that verifies the signature verification:

```Solidity
File: StRSRVotes.sol
166:     function delegateBySig(
167:         address delegatee,
168:         uint256 nonce,
169:         uint256 expiry,
170:         uint8 v,
171:         bytes32 r,
172:         bytes32 s
173:     ) public {
174:         require(block.timestamp <= expiry, "signature expired");
175:         address signer = ECDSAUpgradeable.recover(
176:             _hashTypedDataV4(keccak256(abi.encode(_DELEGATE_TYPEHASH, delegatee, nonce, expiry))),
177:             v,
178:             r,
179:             s
180:         );
181:         require(nonce == _useDelegationNonce(signer), "invalid nonce");
182:         _delegate(signer, delegatee);
183:     }
```

We can see that the `era` is missing from the signed payload at L176.

This means that a delegation signature can be reused across era changes, despite balances and voting power no longer apply.

Consider adding an `era` field to the signed payload for `StRSRVotes.delegateBySig()`

## [L-11] Potential DAO fee rounding to zero for upgraded RTokens

Upgraded RTokens might not pay DAO fees even if `daoFeeRegistry` has been set in `Main`. This is due to the change in the distribution total constraint in the `_ensureSufficientTotal()` function.

In previous versions, the check only required one of `rTokenDist` or `rsrDist` to be non-zero. The current implementation requires their sum to be greater than or equal to `MAX_DISTRIBUTION`. RTokens initialized with small distribution values in previous versions might not meet this new constraint after upgrading.

For small `rTokenTotal` and `rsrTotal` values, the [DAO fee calculation](https://github.com/code-423n4/2024-07-reserve/blob/3f133997e186465f4904553b0f8e86ecb7bbacbf/contracts/p1/Distributor.sol#L221-L223)in the `distribute()` function will round down to 0.

Consider implementing a post-upgrade call to `_ensureSufficientTotal()`.

## [L-12] Changing distributions between revenue split and distribution can affect DAO fee amounts

Building upon the issue identified in TRST-L-2 of the Trust Security audit report for v4.0.0, there are additional impacts related to changing distributions between when revenue is split in the `BackingManager` and when it's distributed in the `Distributor`:

1. If RToken governance alters the distribution to heavily favor `rsrTotal` over `rTokenTotal`, they can significantly reduce the effective DAO fee for that cycle.
2. If the DAO changes the fee percentage during this period, the RToken might end up paying more or less than would be fair for that cycle. This is very likely to happen to one RToken or the other whenever veRSR governance changes the fee.

These issues, like the one identified in TRST-L-2, are temporary and limited to single distribution cycles. The first case could be repeated and even automated to continuously evade paying the appropriate DAO fee.

## [L-13] Issuance premium calculation may be inaccurate for view functions

The `issuancePremium()` function in `BasketHandler` assumes that `refresh()` has been called on the collateral token in the current block. If this assumption is not met, it returns `FIX_ONE` instead of calculating the actual premium. While this is generally not an issue because the protocol holds this invariant, it can lead to inaccurate results when called from external view functions that cannot trigger a `refresh()`, such as `RTokenAsset.price()`.

To improve accuracy and consistency, consider modifying `issuancePremium()` to calculate the premium regardless of when `refresh()` was last called. This would ensure more accurate premium values are returned even when accessed through view functions or external calls.

## [L-14] Distribution validation is inconsistent due to inclusion of variable DAO fee

The `Distributor._ensureSufficientTotal()` function is called with the return values of `totals()`, which includes the DAO fee in its calculations. This can lead to a situation where previously valid distributions become invalid if the DAO fee is lowered, as the sum of `rTokenTotal` and `rsrTotal` may fall below `MAX_DISTRIBUTION`.

To ensure consistent behavior regardless of DAO fee changes, `_ensureSufficientTotal()` should only consider the sum of `rTokenDist` and `rsrDist` values from the actual distributions, excluding the DAO fee.

**[tbrent (Reserve) commented](https://github.com/code-423n4/2024-07-reserve-findings/issues/34#issuecomment-2313749813):**
 > L-01 suggestion is great, honorable mention.

***

# [Mitigation Review](#mitigation-review)

## Introduction

Following the C4 audit, 4 wardens ([RadiantLabs](https://code4rena.com/@RadiantLabs) ([3docSec](https://code4rena.com/@3docSec) and [EV\_om](https://code4rena.com/@EV_om)), [ether\_sky](https://code4rena.com/@ether_sky) and [Bauchibred](https://code4rena.com/@Bauchibred)) reviewed the mitigations for all identified issues. Additional details can be found within the [C4 Reserve Core Mitigation Review repository](https://github.com/code-423n4/2024-09-reserve-mitigation).

## Mitigation Review Scope

### Mitigation of High & Medium Severity Issues

| URL                                                    | Mitigation of |
| ------------------------------------------------------ | ------------- |
| https://github.com/reserve-protocol/protocol/pull/1191 | M-01          |
| https://github.com/reserve-protocol/protocol/pull/1198 | M-02          |
| https://github.com/reserve-protocol/protocol/pull/1193 | M-03          |
| https://github.com/reserve-protocol/protocol/pull/1199 | M-05          |
| https://github.com/reserve-protocol/protocol/pull/1194 | M-06          |
| https://github.com/reserve-protocol/protocol/pull/1195 | M-07          |

The sponsor requested some extra eyes on the following changes, since they are not in the "obviously safe" category:

| URL                                                    | Mitigation of |
| ------------------------------------------------------ | ------------- |
| https://github.com/reserve-protocol/protocol/pull/1198 | M-02          |
| https://github.com/reserve-protocol/protocol/pull/1199 | M-05          |

### Additional scope to be reviewed

The following items were additional changes that were in scope for this review, but not directly tied to findings from the original C4 audit.

| URL                                                    | Reference ID |
| ------------------------------------------------------ | ------------- |
| https://github.com/reserve-protocol/protocol/pull/1192 | ADD-01 |
| https://github.com/reserve-protocol/protocol/pull/1196 | ADD-02 |
| https://github.com/reserve-protocol/protocol/pull/1203 | ADD-03 |
| https://github.com/reserve-protocol/protocol/pull/1197 | ADD-04 |
| https://github.com/reserve-protocol/protocol/pull/1201 | ADD-05 |
| https://github.com/reserve-protocol/protocol/pull/1188 | ADD-06 |

## Out of Scope

[M-04: Dutch auctions can fail to settle if any other collateral in the basket behaves unexpectedly](https://github.com/code-423n4/2024-07-reserve-findings/issues/32)


## Mitigation Review Summary

**During the mitigation review, the wardens confirmed that all in-scope findings were mitigated. The table below provides details regarding the status of each in-scope vulnerability from the original audit.**

| Original Issue | Status | Full Details |
| ----------- | ------------- | ----------- |
| M-01 |  🟢 Mitigation Confirmed | Reports from [Bauchibred](https://github.com/code-423n4/2024-09-reserve-mitigation-findings/issues/2), [ether_sky](https://github.com/code-423n4/2024-09-reserve-mitigation-findings/issues/24) and [RadiantLabs](https://github.com/code-423n4/2024-09-reserve-mitigation-findings/issues/14) |
| M-02 |  🟢 Mitigation Confirmed | Reports from [Bauchibred](https://github.com/code-423n4/2024-09-reserve-mitigation-findings/issues/3), [RadiantLabs](https://github.com/code-423n4/2024-09-reserve-mitigation-findings/issues/37) and [ether_sky](https://github.com/code-423n4/2024-09-reserve-mitigation-findings/issues/25) |
| M-03 |  🟢 Mitigation Confirmed | Reports from [Bauchibred](https://github.com/code-423n4/2024-09-reserve-mitigation-findings/issues/4), [ether_sky](https://github.com/code-423n4/2024-09-reserve-mitigation-findings/issues/26) and [RadiantLabs](https://github.com/code-423n4/2024-09-reserve-mitigation-findings/issues/15) |
| M-05 |  🟢 Mitigation Confirmed | Reports from [ether_sky](https://github.com/code-423n4/2024-09-reserve-mitigation-findings/issues/27) and [Bauchibred](https://github.com/code-423n4/2024-09-reserve-mitigation-findings/issues/5) |
| M-06 |  🟢 Mitigation Confirmed | Reports from [Bauchibred](https://github.com/code-423n4/2024-09-reserve-mitigation-findings/issues/6), [ether_sky](https://github.com/code-423n4/2024-09-reserve-mitigation-findings/issues/28) and [RadiantLabs](https://github.com/code-423n4/2024-09-reserve-mitigation-findings/issues/22) |
| M-07 |  🟢 Mitigation Confirmed | Reports from [RadiantLabs](https://github.com/code-423n4/2024-09-reserve-mitigation-findings/issues/17), [ether_sky](https://github.com/code-423n4/2024-09-reserve-mitigation-findings/issues/29) and [Bauchibred](https://github.com/code-423n4/2024-09-reserve-mitigation-findings/issues/7) |
| ADD-01 |  🟢 Mitigation Confirmed | Reports from [RadiantLabs](https://github.com/code-423n4/2024-09-reserve-mitigation-findings/issues/18), [ether_sky](https://github.com/code-423n4/2024-09-reserve-mitigation-findings/issues/30) and [Bauchibred](https://github.com/code-423n4/2024-09-reserve-mitigation-findings/issues/8) |
| ADD-02 |  🟢 Mitigation Confirmed | Reports from [RadiantLabs](https://github.com/code-423n4/2024-09-reserve-mitigation-findings/issues/19), [ether_sky](https://github.com/code-423n4/2024-09-reserve-mitigation-findings/issues/31) and [Bauchibred](https://github.com/code-423n4/2024-09-reserve-mitigation-findings/issues/9) |
| ADD-03 |  🟢 Mitigation Confirmed | Reports from [Bauchibred](https://github.com/code-423n4/2024-09-reserve-mitigation-findings/issues/10), [ether_sky](https://github.com/code-423n4/2024-09-reserve-mitigation-findings/issues/32) and [RadiantLabs](https://github.com/code-423n4/2024-09-reserve-mitigation-findings/issues/20) |
| ADD-04 |  🟢 Mitigation Confirmed | Reports from [ether_sky](https://github.com/code-423n4/2024-09-reserve-mitigation-findings/issues/33), [RadiantLabs](https://github.com/code-423n4/2024-09-reserve-mitigation-findings/issues/38) and [Bauchibred](https://github.com/code-423n4/2024-09-reserve-mitigation-findings/issues/11) |
| ADD-05 |  🟢 Mitigation Confirmed | Reports from [RadiantLabs](https://github.com/code-423n4/2024-09-reserve-mitigation-findings/issues/21), [ether_sky](https://github.com/code-423n4/2024-09-reserve-mitigation-findings/issues/34) and [Bauchibred](https://github.com/code-423n4/2024-09-reserve-mitigation-findings/issues/12) |
| ADD-06 |  🟢 Mitigation Confirmed | Reports from [RadiantLabs](https://github.com/code-423n4/2024-09-reserve-mitigation-findings/issues/36), [ether_sky](https://github.com/code-423n4/2024-09-reserve-mitigation-findings/issues/35) and [Bauchibred](https://github.com/code-423n4/2024-09-reserve-mitigation-findings/issues/13) |
  
# Disclosures

C4 is an open organization governed by participants in the community.

C4 audits incentivize the discovery of exploits, vulnerabilities, and bugs in smart contracts. Security researchers are rewarded at an increasing rate for finding higher-risk issues. Audit submissions are judged by a knowledgeable security researcher and solidity developer and disclosed to sponsoring developers. C4 does not conduct formal verification regarding the provided code but instead provides final verification.

C4 does not provide any guarantee or warranty regarding the security of this project. All smart contract software should be used at the sole risk and responsibility of users.
