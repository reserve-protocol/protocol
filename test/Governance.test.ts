import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, ContractFactory, Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'
import { IConfig } from '../common/configuration'
import { ProposalState, ZERO_ADDRESS, OWNER, FREEZER, PAUSER } from '../common/constants'
import { bn, fp } from '../common/numbers'
import {
  ERC20Mock,
  Governance,
  StRSRP1Votes,
  TestIBackingManager,
  TestIBroker,
  TestIMain,
  TestIStRSR,
  TimelockController,
} from '../typechain'
import { defaultFixture, Implementation, IMPLEMENTATION } from './fixtures'
import { whileImpersonating } from './utils/impersonation'
import { advanceBlocks, advanceTime, getLatestBlockNumber } from './utils/time'

const createFixtureLoader = waffle.createFixtureLoader

const describeP1 = IMPLEMENTATION == Implementation.P1 ? describe : describe.skip

describeP1(`Governance - P${IMPLEMENTATION}`, () => {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress
  let addr2: SignerWithAddress
  let addr3: SignerWithAddress
  let other: SignerWithAddress

  // RSR
  let rsr: ERC20Mock

  // Config
  let config: IConfig

  // Core contracts
  let governor: Governance
  let main: TestIMain
  let backingManager: TestIBackingManager
  let broker: TestIBroker
  let stRSR: TestIStRSR
  let timelock: TimelockController
  let stRSRVotes: StRSRP1Votes

  // Factories
  let GovernorFactory: ContractFactory
  let TimelockFactory: ContractFactory

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  let initialBal: BigNumber

  const MIN_DELAY = 60 * 60 * 24 // 1 day
  const VOTING_DELAY = 5 // 5 blocks
  const VOTING_PERIOD = 100 // 100 blocks
  const PROPOSAL_THRESHOLD = 1e6 // 1%
  const QUORUM_PERCENTAGE = 4 // 4%

  before('create fixture loader', async () => {
    ;[wallet] = (await ethers.getSigners()) as unknown as Wallet[]
    loadFixture = createFixtureLoader([wallet])
  })

  beforeEach(async () => {
    ;[owner, addr1, addr2, addr3, other] = await ethers.getSigners()

    // Deploy fixture
    ;({ rsr, config, main, broker, backingManager, stRSR } = await loadFixture(defaultFixture))

    initialBal = bn('10000e18')
    await rsr.connect(owner).mint(addr1.address, initialBal)
    await rsr.connect(owner).mint(addr2.address, initialBal)
    await rsr.connect(owner).mint(addr3.address, initialBal)

    // Cast to ERC20Votes contract
    stRSRVotes = <StRSRP1Votes>await ethers.getContractAt('StRSRP1Votes', stRSR.address)

    // Deploy Tiuelock
    TimelockFactory = await ethers.getContractFactory('TimelockController')
    timelock = <TimelockController>await TimelockFactory.deploy(MIN_DELAY, [], [])

    // Deploy Governor
    GovernorFactory = await ethers.getContractFactory('Governance')
    governor = <Governance>(
      await GovernorFactory.deploy(
        stRSRVotes.address,
        timelock.address,
        VOTING_DELAY,
        VOTING_PERIOD,
        PROPOSAL_THRESHOLD,
        QUORUM_PERCENTAGE
      )
    )

    // Setup Roles
    const proposerRole = await timelock.PROPOSER_ROLE()
    const executorRole = await timelock.EXECUTOR_ROLE()
    const adminRole = await timelock.TIMELOCK_ADMIN_ROLE()

    // Setup Governor as only proposer
    await timelock.grantRole(proposerRole, governor.address)

    // Setup anyone as executor
    await timelock.grantRole(executorRole, ZERO_ADDRESS)

    // Revoke admin role - All changes in Timelock have to go through Governance
    await timelock.revokeRole(adminRole, owner.address)

    // Transfer ownership of Main to the Timelock (and thus, Governor)
    await main.grantRole(OWNER, timelock.address)
    await main.grantRole(FREEZER, timelock.address)
    await main.grantRole(PAUSER, timelock.address)

    // Renounce all roles from owner
    await main.renounceRole(OWNER, owner.address)
    await main.renounceRole(FREEZER, owner.address)
    await main.renounceRole(PAUSER, owner.address)
  })

  describe('Deployment / Setup', () => {
    it('Should deploy Governor correctly', async () => {
      expect(await governor.votingDelay()).to.equal(VOTING_DELAY)
      expect(await governor.votingPeriod()).to.equal(VOTING_PERIOD)
      expect(await governor.proposalThreshold()).to.equal(PROPOSAL_THRESHOLD)
      expect(await governor.name()).to.equal('MyGovernor')
      // Quorum
      expect(await governor.quorumNumerator()).to.equal(QUORUM_PERCENTAGE)
      expect(await governor.quorumDenominator()).to.equal(100)
      expect(await governor.quorum((await getLatestBlockNumber()) - 1)).to.equal(
        QUORUM_PERCENTAGE * 1e6
      ) // 4e6 = 4%

      expect(await governor.timelock()).to.equal(timelock.address)
      expect(await governor.token()).to.equal(stRSRVotes.address)
    })

    it('Should setup Timelock (Governance) as owner', async () => {
      // Check owner
      expect(await main.hasRole(OWNER, timelock.address)).to.equal(true)

      // If not the owner cannot update
      await expect(backingManager.connect(owner).setTradingDelay(bn(360))).to.be.revertedWith(
        'governance only'
      )
    })

    it('Should return votes correctly', async () => {
      const stkAmt1: BigNumber = bn('1000e18')
      const stkAmt2: BigNumber = bn('500e18')

      // Initially no supply at all
      let currBlockNumber: number = (await getLatestBlockNumber()) - 1
      expect(await stRSRVotes.getPastTotalSupply(currBlockNumber)).to.equal(0)
      expect(await governor.getVotes(addr1.address, currBlockNumber)).to.equal(0)
      expect(await governor.getVotes(addr2.address, currBlockNumber)).to.equal(0)
      expect(await governor.getVotes(addr3.address, currBlockNumber)).to.equal(0)

      // Stake some RSR with addr1 - And delegate
      await rsr.connect(addr1).approve(stRSRVotes.address, stkAmt1)
      await stRSRVotes.connect(addr1).stake(stkAmt1)
      await stRSRVotes.connect(addr1).delegate(addr1.address)

      // Advance a few blocks
      await advanceBlocks(2)

      // Check new values - Owner has 100% of vote
      currBlockNumber = (await getLatestBlockNumber()) - 1
      expect(await stRSRVotes.getPastTotalSupply(currBlockNumber)).to.equal(stkAmt1)
      expect(await governor.getVotes(addr1.address, currBlockNumber)).to.equal(1e8) // 100%
      expect(await governor.getVotes(addr2.address, currBlockNumber)).to.equal(0)
      expect(await governor.getVotes(addr3.address, currBlockNumber)).to.equal(0)

      // Stake some RSR with addr2 - And delegate
      await rsr.connect(addr2).approve(stRSRVotes.address, stkAmt1)
      await stRSRVotes.connect(addr2).stake(stkAmt1)
      await stRSRVotes.connect(addr2).delegate(addr2.address)

      // Advance a few blocks
      await advanceBlocks(2)

      // Check new values - Addr1 and addr2 have 50% of vote each
      currBlockNumber = (await getLatestBlockNumber()) - 1
      expect(await stRSRVotes.getPastTotalSupply(currBlockNumber)).to.equal(stkAmt1.mul(2))
      expect(await governor.getVotes(addr1.address, currBlockNumber)).to.equal(5e7) // 50%
      expect(await governor.getVotes(addr2.address, currBlockNumber)).to.equal(5e7) // 50%
      expect(await governor.getVotes(addr3.address, currBlockNumber)).to.equal(0)

      // Stake a smaller portion of RSR with addr3 (20% of total)
      await rsr.connect(addr3).approve(stRSRVotes.address, stkAmt2)
      await stRSRVotes.connect(addr3).stake(stkAmt2)
      await stRSRVotes.connect(addr3).delegate(addr3.address)

      // Advance a few blocks
      await advanceBlocks(2)

      // Check new values - Addr1 and addr2 have 40% of vote each
      currBlockNumber = (await getLatestBlockNumber()) - 1
      expect(await stRSRVotes.getPastTotalSupply(currBlockNumber)).to.equal(
        stkAmt1.mul(2).add(stkAmt2)
      )

      expect(await governor.getVotes(addr1.address, currBlockNumber)).to.equal(4e7) // 40%
      expect(await governor.getVotes(addr2.address, currBlockNumber)).to.equal(4e7) // 40%
      expect(await governor.getVotes(addr3.address, currBlockNumber)).to.equal(2e7) // 20%
    })

    it('Should be able to return if supports Interface', async () => {
      // Governor interface
      let interfaceID: BigNumber = ethers.constants.Zero
      const functions: string[] = [
        'name()',
        'version()',
        'COUNTING_MODE()',
        'hashProposal(address[],uint256[],bytes[],bytes32)',
        'state(uint256)',
        'proposalSnapshot(uint256)',
        'proposalDeadline(uint256)',
        'votingDelay()',
        'votingPeriod()',
        'quorum(uint256)',
        'getVotes(address,uint256)',
        'hasVoted(uint256,address)',
        'propose(address[],uint256[],bytes[],string)',
        'execute(address[],uint256[],bytes[],bytes32)',
        'castVote(uint256,uint8)',
        'castVoteWithReason(uint256,uint8,string)',
        'castVoteBySig(uint256,uint8,uint8,bytes32,bytes32)',
      ]
      for (let i = 0; i < functions.length; i++) {
        interfaceID = interfaceID.xor(governor.interface.getSighash(functions[i]))
      }

      expect(await governor.supportsInterface(interfaceID._hex)).to.equal(true)
    })
  })

  describe('Proposals', () => {
    // Proposal details
    const newValue: BigNumber = bn('360')
    const proposalDescription = 'Proposal #1 - Update Trading Delay to 360'
    let encodedFunctionCall: string
    let stkAmt1: BigNumber
    let stkAmt2: BigNumber

    beforeEach(async () => {
      // Stake amounts
      stkAmt1 = bn('1000e18')
      stkAmt2 = bn('10e18')

      // set encoded call
      encodedFunctionCall = backingManager.interface.encodeFunctionData('setTradingDelay', [
        newValue,
      ])

      // Stake RSR with addr1 - And delegate
      await rsr.connect(addr1).approve(stRSRVotes.address, stkAmt1)
      await stRSRVotes.connect(addr1).stake(stkAmt1)
      await stRSRVotes.connect(addr1).delegate(addr1.address)

      // Stake RSR with addr2 - And delegate
      await rsr.connect(addr2).approve(stRSRVotes.address, stkAmt1)
      await stRSRVotes.connect(addr2).stake(stkAmt1)
      await stRSRVotes.connect(addr2).delegate(addr2.address)

      // Advance a few blocks
      await advanceBlocks(2)
    })

    it('Should only allow to propose above the proposal threshold', async () => {
      // Stake RSR with addr3 - And delegate
      await rsr.connect(addr3).approve(stRSRVotes.address, stkAmt2)
      await stRSRVotes.connect(addr3).stake(stkAmt2)
      await stRSRVotes.connect(addr3).delegate(addr3.address)

      // Check proposer threshold is not enought for caller
      expect(await governor.getVotes(addr3.address, (await getLatestBlockNumber()) - 1)).to.be.lt(
        PROPOSAL_THRESHOLD
      )

      // Propose will fail
      await expect(
        governor
          .connect(addr3)
          .propose([backingManager.address], [0], [encodedFunctionCall], proposalDescription)
      ).to.be.revertedWith('Governor: proposer votes below proposal threshold')

      // Stake more tokens to go above threshold of 1% (required >10.2e18 at current supply)
      await rsr.connect(addr3).approve(stRSRVotes.address, bn('10.5e18'))
      await stRSRVotes.connect(addr3).stake(bn('10.5e18'))

      // Propose will fail again
      await advanceBlocks(5)

      expect(await governor.getVotes(addr3.address, (await getLatestBlockNumber()) - 1)).to.be.gt(
        PROPOSAL_THRESHOLD
      )

      const proposeTx = await governor
        .connect(addr3)
        .propose([backingManager.address], [0], [encodedFunctionCall], proposalDescription)

      const proposeReceipt = await proposeTx.wait(1)
      const proposalId = proposeReceipt.events![0].args!.proposalId

      // Check proposal state
      expect(await governor.state(proposalId)).to.equal(ProposalState.Pending)
    })

    it('Should allow to cancel a proposal if proposer', async () => {
      // Propose
      const proposeTx = await governor
        .connect(addr1)
        .propose([backingManager.address], [0], [encodedFunctionCall], proposalDescription)

      const proposeReceipt = await proposeTx.wait(1)
      const proposalId = proposeReceipt.events![0].args!.proposalId

      // Check proposal state
      expect(await governor.state(proposalId)).to.equal(ProposalState.Pending)

      await expect(governor.connect(other).cancel(proposalId)).to.be.revertedWith(
        'Governor: proposer above threshold and same era'
      )

      // Proposer can cancel
      await expect(governor.connect(addr1).cancel(proposalId))
        .to.emit(governor, 'ProposalCanceled')
        .withArgs(proposalId)

      // Check proposal state
      expect(await governor.state(proposalId)).to.equal(ProposalState.Canceled)
    })

    it('Should allow to cancel a proposal if era changes', async () => {
      // Propose
      const proposeTx = await governor
        .connect(addr1)
        .propose([backingManager.address], [0], [encodedFunctionCall], proposalDescription)

      const proposeReceipt = await proposeTx.wait(1)
      const proposalId = proposeReceipt.events![0].args!.proposalId

      // Check proposal state
      expect(await governor.state(proposalId)).to.equal(ProposalState.Pending)

      // Advance time to start voting
      await advanceBlocks(VOTING_DELAY + 1)

      // Force change of era - Perform wipeout
      await whileImpersonating(backingManager.address, async (signer) => {
        await expect(stRSRVotes.connect(signer).seizeRSR(stkAmt1.mul(2)))
          .to.emit(stRSR, 'ExchangeRateSet')
          .withArgs(fp('1'), fp('1'))
      })

      // Anyone can cancel if era changed
      await expect(governor.connect(other).cancel(proposalId))
        .to.emit(governor, 'ProposalCanceled')
        .withArgs(proposalId)

      // Check proposal state
      expect(await governor.state(proposalId)).to.equal(ProposalState.Canceled)
    })

    it('Should allow to cancel if proposer is below threshold', async () => {
      // Propose
      const proposeTx = await governor
        .connect(addr1)
        .propose([backingManager.address], [0], [encodedFunctionCall], proposalDescription)

      const proposeReceipt = await proposeTx.wait(1)
      const proposalId = proposeReceipt.events![0].args!.proposalId

      // Check proposal state
      expect(await governor.state(proposalId)).to.equal(ProposalState.Pending)

      // Unstake with proposer
      const unstakeDelay: number = await stRSRVotes.unstakingDelay()
      await stRSRVotes.connect(addr1).unstake(stkAmt1)
      await advanceTime(unstakeDelay + 1)
      await stRSRVotes.connect(addr1).withdraw(addr1.address, 1)

      // Check votes
      expect(await stRSRVotes.getVotes(addr1.address)).to.equal(0)

      // Advance time to start voting
      await advanceBlocks(VOTING_DELAY + 1)

      // Anyone can cancel if proposer is below threshold
      await expect(governor.connect(other).cancel(proposalId))
        .to.emit(governor, 'ProposalCanceled')
        .withArgs(proposalId)

      // Check proposal state
      expect(await governor.state(proposalId)).to.equal(ProposalState.Canceled)
    })

    it('Should allow to cancel if there is a significant rate change', async () => {
      // Propose
      const proposeTx = await governor
        .connect(addr1)
        .propose([backingManager.address], [0], [encodedFunctionCall], proposalDescription)

      const proposeReceipt = await proposeTx.wait(1)
      const proposalId = proposeReceipt.events![0].args!.proposalId

      // Check proposal state
      expect(await governor.state(proposalId)).to.equal(ProposalState.Pending)

      // Change Rate (small increase by 25%)
      const seizeAmt1 = bn('400e18')
      await whileImpersonating(backingManager.address, async (signer) => {
        await expect(stRSRVotes.connect(signer).seizeRSR(seizeAmt1))
          .to.emit(stRSR, 'ExchangeRateSet')
          .withArgs(fp('1'), fp('1.25'))
      })

      // Change Rate (increase by additinal 35%)
      const seizeAmt2 = bn('350e18')
      await whileImpersonating(backingManager.address, async (signer) => {
        await expect(stRSRVotes.connect(signer).seizeRSR(seizeAmt2))
          .to.emit(stRSR, 'ExchangeRateSet')
          .withArgs(fp('1.25'), fp('1.6'))
      })

      // An attacker can stake here (will have double weight)
      // Stake RSR with addr3 - And delegate
      await rsr.connect(addr3).approve(stRSRVotes.address, stkAmt1)
      await stRSRVotes.connect(addr3).stake(stkAmt1)
      await stRSRVotes.connect(addr3).delegate(addr3.address)

      // Advance time to start voting
      await advanceBlocks(VOTING_DELAY + 1)

      // First exchange rate change does not trigger cancel
      await expect(governor.connect(other).alternativeCancel(proposalId, 0, 1)).to.be.revertedWith(
        'Governor: rate not inflated'
      )

      // Second exchange rate change does not trigger cancel
      await expect(governor.connect(other).alternativeCancel(proposalId, 1, 2)).to.be.revertedWith(
        'Governor: rate not inflated'
      )

      // By comparing the initial and final checkpoints, anyone can cancel
      await expect(governor.connect(other).alternativeCancel(proposalId, 0, 2))
        .to.emit(governor, 'ProposalCanceled')
        .withArgs(proposalId)

      // Check proposal state
      expect(await governor.state(proposalId)).to.equal(ProposalState.Canceled)
    })

    it('Should complete full cycle', async () => {
      // Check current value
      expect(await backingManager.tradingDelay()).to.equal(config.tradingDelay)

      // Propose
      const proposeTx = await governor
        .connect(addr1)
        .propose([backingManager.address], [0], [encodedFunctionCall], proposalDescription)

      const proposeReceipt = await proposeTx.wait(1)
      const proposalId = proposeReceipt.events![0].args!.proposalId

      // Check proposal state
      expect(await governor.state(proposalId)).to.equal(ProposalState.Pending)

      // Advance time to start voting
      await advanceBlocks(VOTING_DELAY + 1)

      // Check proposal state
      expect(await governor.state(proposalId)).to.equal(ProposalState.Active)

      const voteWay = 1 // for

      // vote
      await governor.connect(addr1).castVote(proposalId, voteWay)
      await advanceBlocks(1)

      await governor.connect(addr2).castVoteWithReason(proposalId, voteWay, 'I vote for')
      await advanceBlocks(1)

      // Check proposal state
      expect(await governor.state(proposalId)).to.equal(ProposalState.Active)

      // Advance time till voting is complete
      await advanceBlocks(VOTING_PERIOD + 1)

      // Finished voting - Check proposal state
      expect(await governor.state(proposalId)).to.equal(ProposalState.Succeeded)

      // Using Bravo-type signature
      await governor['queue(uint256)'](proposalId)

      // Check proposal state
      expect(await governor.state(proposalId)).to.equal(ProposalState.Queued)

      // Advance time required by timelock
      await advanceTime(MIN_DELAY + 1)
      await advanceBlocks(1)

      // Execute - using Bravo-type signature
      await governor['execute(uint256)'](proposalId)

      // Check proposal state
      expect(await governor.state(proposalId)).to.equal(ProposalState.Executed)

      // Check value was updated
      expect(await backingManager.tradingDelay()).to.equal(newValue)
    })

    it('Should handle change of era properly - prevents execution', async () => {
      // Check current value
      expect(await backingManager.tradingDelay()).to.equal(config.tradingDelay)

      // Propose
      const proposeTx = await governor
        .connect(addr1)
        .propose([backingManager.address], [0], [encodedFunctionCall], proposalDescription)

      const proposeReceipt = await proposeTx.wait(1)
      const proposalId = proposeReceipt.events![0].args!.proposalId

      // Check proposal state
      expect(await governor.state(proposalId)).to.equal(ProposalState.Pending)

      // Advance time to start voting
      await advanceBlocks(VOTING_DELAY + 1)

      const snapshotBlock = (await getLatestBlockNumber()) - 1

      const voteWay = 1 // for

      // Check proposal state
      expect(await governor.state(proposalId)).to.equal(ProposalState.Active)

      // Voting started - Check votes
      expect(await governor.getVotes(addr1.address, snapshotBlock)).to.equal(5e7) // 50%
      expect(await governor.getVotes(addr2.address, snapshotBlock)).to.equal(5e7) // 50%

      // Vote with addr1
      await governor.connect(addr1).castVote(proposalId, voteWay)
      await advanceBlocks(1)

      // Perform wipeout
      await whileImpersonating(backingManager.address, async (signer) => {
        await expect(stRSRVotes.connect(signer).seizeRSR(stkAmt1.mul(2)))
          .to.emit(stRSR, 'ExchangeRateSet')
          .withArgs(fp('1'), fp('1'))
      })

      // Check wipeout
      expect(await stRSRVotes.getVotes(addr1.address)).to.equal(0)
      expect(await stRSRVotes.getVotes(addr2.address)).to.equal(0)

      // Votes do not change for this proposal (uses snapshot)
      expect(await governor.getVotes(addr1.address, snapshotBlock)).to.equal(5e7) // 50%
      expect(await governor.getVotes(addr2.address, snapshotBlock)).to.equal(5e7) // 50%

      // Check proposal state - Still active
      expect(await governor.state(proposalId)).to.equal(ProposalState.Active)

      // Vote with addr2
      await governor.connect(addr2).castVoteWithReason(proposalId, voteWay, 'I vote for')
      await advanceBlocks(1)

      // Advance time to finish voting
      await advanceBlocks(VOTING_PERIOD + 1)

      // Check proposal state
      expect(await governor.state(proposalId)).to.equal(ProposalState.Succeeded)

      // Queue & execute
      const descriptionHash = ethers.utils.id(proposalDescription)
      await governor['queue(address[],uint256[],bytes[],bytes32)'](
        [backingManager.address],
        [0],
        [encodedFunctionCall],
        descriptionHash
      )
      expect(await governor.state(proposalId)).to.equal(ProposalState.Queued)

      // Advance time required by timelock
      await advanceTime(MIN_DELAY + 1)

      // Execute - Will fail if era changed
      await expect(
        governor['execute(address[],uint256[],bytes[],bytes32)'](
          [backingManager.address],
          [0],
          [encodedFunctionCall],
          descriptionHash
        )
      ).to.be.revertedWith('new era')

      // Check proposal, remains queued until expired
      expect(await governor.state(proposalId)).to.equal(ProposalState.Queued)

      // Check value was not updated
      expect(await backingManager.tradingDelay()).to.equal(config.tradingDelay)
    })

    it('Should handle multiple proposals with different rates', async () => {
      // Check current values
      expect(await backingManager.tradingDelay()).to.equal(config.tradingDelay)
      expect(await main.broker()).to.equal(broker.address)

      // Proposal 1
      const proposeTx = await governor
        .connect(addr1)
        .propose([backingManager.address], [0], [encodedFunctionCall], proposalDescription)

      const proposeReceipt = await proposeTx.wait(1)
      const proposalId = proposeReceipt.events![0].args!.proposalId

      // Check proposal state
      expect(await governor.state(proposalId)).to.equal(ProposalState.Pending)

      // Advance time to start voting
      await advanceBlocks(VOTING_DELAY + 1)

      const snapshotBlock1 = (await getLatestBlockNumber()) - 1

      // Change Rate (decrease by 50%) - should only impact the new proposal
      await whileImpersonating(backingManager.address, async (signer) => {
        await expect(stRSRVotes.connect(signer).seizeRSR(stkAmt1))
          .to.emit(stRSR, 'ExchangeRateSet')
          .withArgs(fp('1'), fp('2'))
      })

      // Create another proposal to replace broker
      expect(await main.hasRole(FREEZER, other.address)).to.equal(false)
      const newEncodedFunctionCall = main.interface.encodeFunctionData('grantRole', [
        FREEZER,
        other.address,
      ])
      const proposalDescription2 = 'Proposal #2 - Grant new freezer'
      const proposeTx2 = await governor
        .connect(addr1)
        .propose([main.address], [0], [newEncodedFunctionCall], proposalDescription2)
      const proposeReceipt2 = await proposeTx2.wait(1)
      const proposalId2 = proposeReceipt2.events![0].args!.proposalId

      // Check proposal states
      expect(await governor.state(proposalId)).to.equal(ProposalState.Active)
      expect(await governor.state(proposalId2)).to.equal(ProposalState.Pending)

      // Perform new stake (will have double weight)
      // Stake RSR with addr3 - And delegate
      await rsr.connect(addr3).approve(stRSRVotes.address, stkAmt1)
      await stRSRVotes.connect(addr3).stake(stkAmt1)
      await stRSRVotes.connect(addr3).delegate(addr3.address)

      // Advance time to start voting 2nd proposal
      await advanceBlocks(VOTING_DELAY + 1)

      const snapshotBlock2 = (await getLatestBlockNumber()) - 1

      // Check proposal states
      expect(await governor.state(proposalId)).to.equal(ProposalState.Active)
      expect(await governor.state(proposalId2)).to.equal(ProposalState.Active)

      // Check votes being used for each proposal
      // Proposal 1
      expect(await governor.getVotes(addr1.address, snapshotBlock1)).to.equal(5e7) // 50%
      expect(await governor.getVotes(addr2.address, snapshotBlock1)).to.equal(5e7) // 50%
      expect(await governor.getVotes(addr3.address, snapshotBlock1)).to.equal(0) // 0%

      // Proposal 2
      expect(await governor.getVotes(addr1.address, snapshotBlock2)).to.equal(2.5e7) // 25%
      expect(await governor.getVotes(addr2.address, snapshotBlock2)).to.equal(2.5e7) // 25%
      expect(await governor.getVotes(addr3.address, snapshotBlock2)).to.equal(5e7) // 50%

      // Votes Proposal #1
      const voteFor = 1 // for
      const voteAgainst = 0 // against

      // Votes Proposal #1
      await governor.connect(addr1).castVote(proposalId, voteFor)
      await governor.connect(addr2).castVote(proposalId, voteAgainst)
      await advanceBlocks(1)

      // Votes Proposal #2
      await governor.connect(addr1).castVote(proposalId2, voteAgainst)
      await governor.connect(addr3).castVote(proposalId2, voteFor)
      await advanceBlocks(1)

      //   Advance time till voting is complete for both proposals
      await advanceBlocks(VOTING_PERIOD + 1)

      // Proposal #1 - Final results
      expect(await governor.state(proposalId)).to.equal(ProposalState.Defeated)

      // Proposal #2 - Final results
      expect(await governor.state(proposalId2)).to.equal(ProposalState.Succeeded)

      // Queue
      // Attempt to queue proposal #1
      await expect(governor['queue(uint256)'](proposalId)).to.be.revertedWith(
        'Governor: proposal not successful'
      )

      // Queue proposal #2
      await governor['queue(uint256)'](proposalId2)

      //   Check proposal state
      expect(await governor.state(proposalId2)).to.equal(ProposalState.Queued)

      // Advance time required by timelock
      await advanceTime(MIN_DELAY + 1)
      await advanceBlocks(1)

      // Execute
      await governor['execute(uint256)'](proposalId2)

      // Check proposal state
      expect(await governor.state(proposalId2)).to.equal(ProposalState.Executed)

      // Check role was granted
      expect(await main.hasRole(FREEZER, other.address)).to.equal(true)
    })
  })
})
