import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber } from 'ethers'
import { ethers } from 'hardhat'
import { IConfig } from '../common/configuration'
import {
  ProposalState,
  ZERO_ADDRESS,
  OWNER,
  SHORT_FREEZER,
  LONG_FREEZER,
  PAUSER,
} from '../common/constants'
import { bn, fp } from '../common/numbers'
import {
  ERC20Mock,
  Governance,
  Governance__factory,
  StRSRP1Votes,
  TestIBackingManager,
  TestIBroker,
  TestIMain,
  TestIStRSR,
  TimelockController,
  TimelockController__factory,
} from '../typechain'
import { defaultFixture, Implementation, IMPLEMENTATION } from './fixtures'
import { whileImpersonating } from './utils/impersonation'
import { advanceBlocks, advanceTime, getLatestBlockTimestamp } from './utils/time'

const describeP1 = IMPLEMENTATION == Implementation.P1 ? describe : describe.skip

describeP1(`Governance - P${IMPLEMENTATION}`, () => {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress
  let addr2: SignerWithAddress
  let addr3: SignerWithAddress
  let other: SignerWithAddress
  let guardian: SignerWithAddress

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
  let GovernorFactory: Governance__factory
  let TimelockFactory: TimelockController__factory

  let initialBal: BigNumber

  const ONE_DAY = 86400

  const MIN_DELAY = ONE_DAY * 7 // 7 days
  const VOTING_DELAY = ONE_DAY // 1 day (in s)
  const VOTING_PERIOD = ONE_DAY * 3 // 3 days (in s)
  const PROPOSAL_THRESHOLD = 1e6 // 1%
  const QUORUM_PERCENTAGE = 4 // 4%

  beforeEach(async () => {
    ;[owner, addr1, addr2, addr3, other, guardian] = await ethers.getSigners()

    // Deploy fixture
    ;({ rsr, config, main, broker, backingManager, stRSR } = await loadFixture(defaultFixture))

    initialBal = bn('10000e18')
    await rsr.connect(owner).mint(addr1.address, initialBal)
    await rsr.connect(owner).mint(addr2.address, initialBal)
    await rsr.connect(owner).mint(addr3.address, initialBal)

    // Cast to ERC20Votes contract
    stRSRVotes = await ethers.getContractAt('StRSRP1Votes', stRSR.address)

    // Deploy Timelock
    TimelockFactory = await ethers.getContractFactory('TimelockController')
    timelock = <TimelockController>await TimelockFactory.deploy(MIN_DELAY, [], [], owner.address)

    // Deploy Governor
    GovernorFactory = await ethers.getContractFactory('Governance')
    governor = await GovernorFactory.deploy(
      stRSRVotes.address,
      timelock.address,
      VOTING_DELAY,
      VOTING_PERIOD,
      PROPOSAL_THRESHOLD,
      QUORUM_PERCENTAGE
    )

    // Setup Roles
    const proposerRole = await timelock.PROPOSER_ROLE()
    const executorRole = await timelock.EXECUTOR_ROLE()
    const cancellerRole = await timelock.CANCELLER_ROLE()
    const adminRole = await timelock.TIMELOCK_ADMIN_ROLE()

    // Setup Governor as only proposer
    await timelock.grantRole(proposerRole, governor.address)

    // Setup Governor as only executor
    await timelock.grantRole(executorRole, governor.address)

    // Setup guardian as canceller
    await timelock.grantRole(cancellerRole, guardian.address)

    // Setup governance as canceller
    await timelock.grantRole(cancellerRole, governor.address)

    // Revoke admin role - All changes in Timelock have to go through Governance
    await timelock.revokeRole(adminRole, owner.address)

    // Transfer ownership of Main to the Timelock (and thus, Governor)
    await main.grantRole(OWNER, timelock.address)
    await main.grantRole(SHORT_FREEZER, timelock.address)
    await main.grantRole(LONG_FREEZER, timelock.address)
    await main.grantRole(PAUSER, timelock.address)

    // Renounce all roles from owner
    await main.renounceRole(OWNER, owner.address)
    await main.renounceRole(SHORT_FREEZER, owner.address)
    await main.renounceRole(LONG_FREEZER, owner.address)
    await main.renounceRole(PAUSER, owner.address)
  })

  describe('Deployment / Setup', () => {
    it('Should deploy Governor correctly', async () => {
      expect(await governor.votingDelay()).to.equal(VOTING_DELAY)
      expect(await governor.votingPeriod()).to.equal(VOTING_PERIOD)
      expect(await governor.name()).to.equal('Governor Anastasius')

      // Quorum
      expect(await governor['quorumNumerator()']()).to.equal(QUORUM_PERCENTAGE)
      expect(await governor.quorumDenominator()).to.equal(100)

      // At first with no StRSR supply, these should be 0
      expect(await governor.proposalThreshold()).to.equal(0)
      expect(await governor.quorum((await getLatestBlockTimestamp()) - 1)).to.equal(0)

      // Other contract addresses
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
      let currentBlockTimestamp: number = (await getLatestBlockTimestamp()) - 1

      expect(await stRSRVotes.getPastTotalSupply(currentBlockTimestamp)).to.equal(0)
      expect(await governor.getVotes(addr1.address, currentBlockTimestamp)).to.equal(0)
      expect(await governor.getVotes(addr2.address, currentBlockTimestamp)).to.equal(0)
      expect(await governor.getVotes(addr3.address, currentBlockTimestamp)).to.equal(0)

      // Stake some RSR with addr1 - And delegate
      await rsr.connect(addr1).approve(stRSRVotes.address, stkAmt1)
      await stRSRVotes.connect(addr1).stake(stkAmt1)

      // Before delegate, should remain 0
      currentBlockTimestamp = (await getLatestBlockTimestamp()) - 1
      expect(await stRSRVotes.getPastTotalSupply(currentBlockTimestamp)).to.equal(0)
      expect(await governor.getVotes(addr1.address, currentBlockTimestamp)).to.equal(0)
      expect(await governor.getVotes(addr2.address, currentBlockTimestamp)).to.equal(0)
      expect(await governor.getVotes(addr3.address, currentBlockTimestamp)).to.equal(0)
      expect(await governor.proposalThreshold()).to.equal(0)
      expect(await governor.quorum((await getLatestBlockTimestamp()) - 1)).to.equal(0)

      // Now delegate
      await stRSRVotes.connect(addr1).delegate(addr1.address)
      expect(await governor.proposalThreshold()).to.equal(
        stkAmt1.mul(PROPOSAL_THRESHOLD).div(bn('1e8'))
      )
      expect(await governor.quorum((await getLatestBlockTimestamp()) - 1)).to.equal(
        stkAmt1.mul(QUORUM_PERCENTAGE).div(100)
      )

      // Advance a few blocks
      await advanceBlocks(2)

      // Check new values - Owner has their stkAmt1 vote
      currentBlockTimestamp = (await getLatestBlockTimestamp()) - 1
      expect(await stRSRVotes.getPastTotalSupply(currentBlockTimestamp)).to.equal(stkAmt1)
      expect(await governor.getVotes(addr1.address, currentBlockTimestamp)).to.equal(stkAmt1)
      expect(await governor.getVotes(addr2.address, currentBlockTimestamp)).to.equal(0)
      expect(await governor.getVotes(addr3.address, currentBlockTimestamp)).to.equal(0)

      // Stake some RSR with addr2, delegate in same transaction
      await rsr.connect(addr2).approve(stRSRVotes.address, stkAmt1)
      await stRSRVotes.connect(addr2).stakeAndDelegate(stkAmt1, ZERO_ADDRESS)

      // Advance a few blocks
      await advanceBlocks(2)

      // Check new values - Addr1 and addr2 both have stkAmt1
      currentBlockTimestamp = (await getLatestBlockTimestamp()) - 1
      expect(await stRSRVotes.getPastTotalSupply(currentBlockTimestamp)).to.equal(stkAmt1.mul(2))
      expect(await governor.getVotes(addr1.address, currentBlockTimestamp)).to.equal(stkAmt1)
      expect(await governor.getVotes(addr2.address, currentBlockTimestamp)).to.equal(stkAmt1)
      expect(await governor.getVotes(addr3.address, currentBlockTimestamp)).to.equal(0)

      // Stake a smaller portion of RSR with addr3
      await rsr.connect(addr3).approve(stRSRVotes.address, stkAmt2)
      await stRSRVotes.connect(addr3).stake(stkAmt2)
      await stRSRVotes.connect(addr3).delegate(addr3.address)

      // Advance a few blocks
      await advanceBlocks(2)

      currentBlockTimestamp = (await getLatestBlockTimestamp()) - 1
      expect(await stRSRVotes.getPastTotalSupply(currentBlockTimestamp)).to.equal(
        stkAmt1.mul(2).add(stkAmt2)
      )

      // Everyone has stkAmt1
      expect(await governor.getVotes(addr1.address, currentBlockTimestamp)).to.equal(stkAmt1)
      expect(await governor.getVotes(addr2.address, currentBlockTimestamp)).to.equal(stkAmt1)
      expect(await governor.getVotes(addr3.address, currentBlockTimestamp)).to.equal(stkAmt2)
    })

    it('Should not allow vote manipulation', async () => {
      const stkAmt: BigNumber = bn('1000e18')
      expect(await stRSRVotes.getVotes(addr1.address)).to.equal(0)

      // Stake some RSR with addr1
      await rsr.connect(addr1).approve(stRSRVotes.address, stkAmt)
      await stRSRVotes.connect(addr1).stake(stkAmt)
      expect(await stRSRVotes.balanceOf(addr1.address)).to.equal(stkAmt)
      expect(await stRSRVotes.getVotes(addr1.address)).to.equal(0)

      // Stake half as much RSR with addr3
      await rsr.connect(addr3).approve(stRSRVotes.address, stkAmt.div(4))
      await stRSRVotes.connect(addr3).stake(stkAmt.div(4))
      expect(await stRSRVotes.balanceOf(addr3.address)).to.equal(stkAmt.div(4))
      expect(await stRSRVotes.getVotes(addr3.address)).to.equal(0)

      // addr1/addr3 delegate to selves to earn voting power
      await stRSRVotes.connect(addr1).delegate(addr1.address)
      await stRSRVotes.connect(addr3).delegate(addr3.address)
      expect(await stRSRVotes.getVotes(addr1.address)).to.equal(stkAmt)
      expect(await stRSRVotes.getVotes(addr2.address)).to.equal(0)
      expect(await stRSRVotes.getVotes(addr3.address)).to.equal(stkAmt.div(4))

      // addr1 delegate to addr2
      await stRSRVotes.connect(addr1).delegate(addr2.address)
      expect(await stRSRVotes.getVotes(addr1.address)).to.equal(0)
      expect(await stRSRVotes.getVotes(addr2.address)).to.equal(stkAmt)
      expect(await stRSRVotes.getVotes(addr3.address)).to.equal(stkAmt.div(4))

      // addr2 delegate back to addr1 -- should have no effect
      await stRSRVotes.connect(addr2).delegate(addr1.address)
      expect(await stRSRVotes.getVotes(addr1.address)).to.equal(0)
      expect(await stRSRVotes.getVotes(addr2.address)).to.equal(stkAmt)
      expect(await stRSRVotes.getVotes(addr3.address)).to.equal(stkAmt.div(4))

      // Transfer addr1 -> addr2
      await stRSRVotes.connect(addr1).transfer(addr2.address, stkAmt)
      expect(await stRSRVotes.balanceOf(addr1.address)).to.equal(0)
      expect(await stRSRVotes.balanceOf(addr2.address)).to.equal(stkAmt)

      // Votes should have swapped places from mutual delegation
      // Yes this is slightly surprising, but makes sense
      expect(await stRSRVotes.getVotes(addr1.address)).to.equal(stkAmt)
      expect(await stRSRVotes.getVotes(addr2.address)).to.equal(0)
      expect(await stRSRVotes.getVotes(addr3.address)).to.equal(stkAmt.div(4))
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

    it('Should perform validations on votingDelay at deployment', async () => {
      // Attempt to deploy with 0 voting delay
      await expect(
        GovernorFactory.deploy(
          stRSRVotes.address,
          timelock.address,
          bn(0),
          VOTING_PERIOD,
          PROPOSAL_THRESHOLD,
          QUORUM_PERCENTAGE
        )
      ).to.be.revertedWith('invalid votingDelay')

      // Attempt to deploy with voting delay below minium (1 day)
      await expect(
        GovernorFactory.deploy(
          stRSRVotes.address,
          timelock.address,
          bn(2000), // less than 1 day
          VOTING_PERIOD,
          PROPOSAL_THRESHOLD,
          QUORUM_PERCENTAGE
        )
      ).to.be.revertedWith('invalid votingDelay')
    })
  })

  describe('Proposals', () => {
    // Proposal details
    const newValue: BigNumber = bn('360')
    let proposalDescription = 'Proposal #1 - Update Trading Delay to 360'
    let proposalDescHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(proposalDescription))
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

      // Check proposer threshold is not enough for caller
      expect(
        await governor.getVotes(addr3.address, (await getLatestBlockTimestamp()) - 1)
      ).to.be.lt(PROPOSAL_THRESHOLD)

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

      expect(
        await governor.getVotes(addr3.address, (await getLatestBlockTimestamp()) - 1)
      ).to.be.gt(PROPOSAL_THRESHOLD)

      const proposeTx = await governor
        .connect(addr3)
        .propose([backingManager.address], [0], [encodedFunctionCall], proposalDescription)

      const proposeReceipt = await proposeTx.wait(1)
      const proposalId = proposeReceipt.events![0].args!.proposalId

      // Check proposal state
      expect(await governor.state(proposalId)).to.equal(ProposalState.Pending)
    })

    it('Should defeat the proposal if quorum is not reached', async () => {
      // Stake RSR with addr3 - And delegate
      await rsr.connect(addr3).approve(stRSRVotes.address, stkAmt2)
      await stRSRVotes.connect(addr3).stake(stkAmt2)
      await stRSRVotes.connect(addr3).delegate(addr3.address)

      // Propose
      const proposeTx = await governor
        .connect(addr1)
        .propose([backingManager.address], [0], [encodedFunctionCall], proposalDescription)

      const proposeReceipt = await proposeTx.wait(1)
      const proposalId = proposeReceipt.events![0].args!.proposalId

      // Check proposal state
      expect(await governor.state(proposalId)).to.equal(ProposalState.Pending)

      await advanceBlocks(VOTING_DELAY + 1)

      // Check proposal state
      expect(await governor.state(proposalId)).to.equal(ProposalState.Active)

      const voteWay = 1 // for

      await governor.connect(addr3).castVote(proposalId, voteWay)
      await advanceBlocks(VOTING_PERIOD + 1)

      // quorum not reached
      expect(await governor.state(proposalId)).to.equal(ProposalState.Defeated)
    })

    it('Should pass the proposal if quorum is reached', async () => {
      // Stake RSR with addr3 - And delegate
      await rsr.connect(addr3).approve(stRSRVotes.address, stkAmt2)
      await stRSRVotes.connect(addr3).stake(stkAmt2)
      await stRSRVotes.connect(addr3).delegate(addr3.address)

      // Propose
      const proposeTx = await governor
        .connect(addr1)
        .propose([backingManager.address], [0], [encodedFunctionCall], proposalDescription)

      const proposeReceipt = await proposeTx.wait(1)
      const proposalId = proposeReceipt.events![0].args!.proposalId

      // Check proposal state
      expect(await governor.state(proposalId)).to.equal(ProposalState.Pending)

      await advanceBlocks(VOTING_DELAY + 1)

      // Check proposal state
      expect(await governor.state(proposalId)).to.equal(ProposalState.Active)

      let voteWay = 1 // for
      await governor.connect(addr3).castVote(proposalId, voteWay)

      voteWay = 2 // abstain
      await governor.connect(addr2).castVoteWithReason(proposalId, voteWay, 'I abstain')
      await advanceBlocks(VOTING_PERIOD + 1)

      // quorum not reached
      expect(await governor.state(proposalId)).to.equal(ProposalState.Succeeded)
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

      let voteWay = 1 // for

      // vote
      await governor.connect(addr1).castVote(proposalId, voteWay)
      await advanceBlocks(1)

      // Quorum should be equal to cast votes
      const expectedQuorum = stkAmt1.mul(2).mul(QUORUM_PERCENTAGE).div(100)
      expect(await governor.quorum((await getLatestBlockTimestamp()) - 1)).to.equal(expectedQuorum)

      voteWay = 2 // abstain
      await governor.connect(addr2).castVoteWithReason(proposalId, voteWay, 'I abstain')
      await advanceBlocks(1)

      // Quorum should be equal to sum of abstain + for votes
      expect(await governor.quorum((await getLatestBlockTimestamp()) - 1)).to.equal(expectedQuorum)

      // Check proposal state
      expect(await governor.state(proposalId)).to.equal(ProposalState.Active)

      // Advance time till voting is complete
      await advanceBlocks(VOTING_PERIOD + 1)

      // Finished voting - Check proposal state
      expect(await governor.state(proposalId)).to.equal(ProposalState.Succeeded)

      // Queue proposal
      await governor
        .connect(addr1)
        .queue([backingManager.address], [0], [encodedFunctionCall], proposalDescHash)

      // Check proposal state
      expect(await governor.state(proposalId)).to.equal(ProposalState.Queued)

      // Advance time required by timelock
      await advanceTime(MIN_DELAY + 1)
      await advanceBlocks(1)

      // Regression test -- Should fail to execute from random EOA
      await expect(
        timelock
          .connect(addr3)
          .executeBatch(
            [backingManager.address],
            [0],
            [encodedFunctionCall],
            '0x0000000000000000000000000000000000000000000000000000000000000000',
            proposalDescHash
          )
      ).to.be.revertedWith(
        'AccessControl: account ' +
          addr3.address.toLowerCase() +
          ' is missing role 0xd8aa0f3194971a2a116679f7c2090f6939c8d4e01a2a8d7e41d55e5351469e63' // executor role
      )

      // Execute
      await governor
        .connect(addr1)
        .execute([backingManager.address], [0], [encodedFunctionCall], proposalDescHash)

      // Check proposal state
      expect(await governor.state(proposalId)).to.equal(ProposalState.Executed)

      // Check value was updated
      expect(await backingManager.tradingDelay()).to.equal(newValue)
    })

    it('Should not allow to queue a proposal if era changes; anyone can cancel', async () => {
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

      // Check proposal state
      expect(await governor.state(proposalId)).to.equal(ProposalState.Succeeded)

      // Force change of era - Perform wipeout
      await whileImpersonating(backingManager.address, async (signer) => {
        await expect(stRSRVotes.connect(signer).seizeRSR(stkAmt1.mul(2)))
          .to.emit(stRSR, 'ExchangeRateSet')
          .withArgs(fp('1'), fp('1'))
      })
      // Cannot queue if era changed
      await expect(
        governor
          .connect(addr1)
          .queue([backingManager.address], [0], [encodedFunctionCall], proposalDescHash)
      ).to.be.revertedWith('new era')

      // Anyone can cancel if era changed
      await expect(
        governor
          .connect(other)
          .cancel([backingManager.address], [0], [encodedFunctionCall], proposalDescHash)
      )
        .to.emit(governor, 'ProposalCanceled')
        .withArgs(proposalId)

      // Check proposal state
      expect(await governor.state(proposalId)).to.equal(ProposalState.Canceled)
    })

    it('Should allow anyone to cancel if era changes, even if queued on timelock', async () => {
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

      // Check proposal state
      expect(await governor.state(proposalId)).to.equal(ProposalState.Succeeded)

      // Queue proposal
      await governor
        .connect(addr1)
        .queue([backingManager.address], [0], [encodedFunctionCall], proposalDescHash)

      // Force change of era - Perform wipeout
      await whileImpersonating(backingManager.address, async (signer) => {
        await expect(stRSRVotes.connect(signer).seizeRSR(stkAmt1.mul(2)))
          .to.emit(stRSR, 'ExchangeRateSet')
          .withArgs(fp('1'), fp('1'))
      })

      // Anyone can cancel even if on Timelock already
      await expect(
        governor
          .connect(other)
          .cancel([backingManager.address], [0], [encodedFunctionCall], proposalDescHash)
      )
        .to.emit(governor, 'ProposalCanceled')
        .withArgs(proposalId)

      // Check proposal state
      expect(await governor.state(proposalId)).to.equal(ProposalState.Canceled)
    })

    it('Should not allow execution of proposal if era changes; guardian can cancel', async () => {
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

      // Check proposal state
      expect(await governor.state(proposalId)).to.equal(ProposalState.Succeeded)

      // Cannot can cancel if same era
      await expect(
        governor
          .connect(addr1)
          .cancel([backingManager.address], [0], [encodedFunctionCall], proposalDescHash)
      ).to.be.revertedWith('same era')

      // Queue proposal
      await governor
        .connect(addr1)
        .queue([backingManager.address], [0], [encodedFunctionCall], proposalDescHash)

      // Force change of era - Perform wipeout
      await whileImpersonating(backingManager.address, async (signer) => {
        await expect(stRSRVotes.connect(signer).seizeRSR(stkAmt1.mul(2)))
          .to.emit(stRSR, 'ExchangeRateSet')
          .withArgs(fp('1'), fp('1'))
      })

      // Check proposal state
      expect(await governor.state(proposalId)).to.equal(ProposalState.Queued)

      // Advance time required by timelock
      await advanceTime(MIN_DELAY + 1)
      await advanceBlocks(1)

      // Should not be able to execute
      await expect(
        governor
          .connect(addr1)
          .execute([backingManager.address], [0], [encodedFunctionCall], proposalDescHash)
      ).to.be.revertedWith('new era')

      // Should be cancellable by guardian
      const timelockId = await timelock.hashOperationBatch(
        [backingManager.address],
        [0],
        [encodedFunctionCall],
        ethers.utils.formatBytes32String(''),
        proposalDescHash
      )
      await timelock.connect(guardian).cancel(timelockId)

      // Check proposal state
      expect(await governor.state(proposalId)).to.equal(ProposalState.Canceled)
    })

    it('Should be cancellable by guardian during timelock delay', async () => {
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

      // Queue proposal
      await governor
        .connect(addr1)
        .queue([backingManager.address], [0], [encodedFunctionCall], proposalDescHash)

      // Check proposal state
      expect(await governor.state(proposalId)).to.equal(ProposalState.Queued)

      // Advance time required by timelock
      await advanceTime(MIN_DELAY + 1)
      await advanceBlocks(1)

      // Should be cancellable by guardian before execute
      const timelockId = await timelock.hashOperationBatch(
        [backingManager.address],
        [0],
        [encodedFunctionCall],
        ethers.utils.formatBytes32String(''),
        proposalDescHash
      )
      await expect(timelock.connect(owner).cancel(timelockId)).to.be.reverted // even owner can't cancel
      await timelock.connect(guardian).cancel(timelockId)

      // Check proposal state
      expect(await governor.state(proposalId)).to.equal(ProposalState.Canceled)

      // Try to execute
      await expect(
        governor
          .connect(addr1)
          .execute([backingManager.address], [0], [encodedFunctionCall], proposalDescHash)
      ).to.be.reverted
    })

    it('Should be cancellable by governor during timelock delay', async () => {
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

      // Queue propoal
      await governor
        .connect(addr1)
        .queue([backingManager.address], [0], [encodedFunctionCall], proposalDescHash)

      // Check proposal state
      expect(await governor.state(proposalId)).to.equal(ProposalState.Queued)

      // Advance time required by timelock
      await advanceTime(MIN_DELAY + 1)
      await advanceBlocks(1)

      // Should be cancellable by guardian before execute
      const timelockId = await timelock.hashOperationBatch(
        [backingManager.address],
        [0],
        [encodedFunctionCall],
        ethers.utils.formatBytes32String(''),
        proposalDescHash
      )
      await expect(timelock.connect(owner).cancel(timelockId)).to.be.reverted // even owner can't cancel

      // Anyone can attempt to cancel via governor (will fail due to era check)
      await expect(
        governor
          .connect(other)
          .cancel([backingManager.address], [0], [encodedFunctionCall], proposalDescHash)
      ).to.be.revertedWith('same era')

      // Governor can cancel proposal directly on Timelock
      await whileImpersonating(governor.address, async (signer) => {
        await expect(timelock.connect(signer).cancel(timelockId)).not.be.reverted
      })

      // Check proposal state
      expect(await governor.state(proposalId)).to.equal(ProposalState.Canceled)

      // Try to execute
      await expect(
        governor
          .connect(addr1)
          .execute([backingManager.address], [0], [encodedFunctionCall], proposalDescHash)
      ).to.be.reverted
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

      const snapshotBlock1 = (await getLatestBlockTimestamp()) - 1

      // Change Rate (decrease by 50%) - should only impact the new proposal
      await whileImpersonating(backingManager.address, async (signer) => {
        await expect(stRSRVotes.connect(signer).seizeRSR(stkAmt1))
          .to.emit(stRSR, 'ExchangeRateSet')
          .withArgs(fp('1'), fp('0.5'))
      })

      // Create another proposal to replace broker
      expect(await main.hasRole(SHORT_FREEZER, other.address)).to.equal(false)
      const newEncodedFunctionCall = main.interface.encodeFunctionData('grantRole', [
        SHORT_FREEZER,
        other.address,
      ])
      const proposalDescription2 = 'Proposal #2 - Grant new freeze starter'
      const proposalDescHash2 = ethers.utils.keccak256(
        ethers.utils.toUtf8Bytes(proposalDescription2)
      )
      const proposeTx2 = await governor
        .connect(addr1)
        .propose([main.address], [0], [newEncodedFunctionCall], proposalDescription2)
      const proposeReceipt2 = await proposeTx2.wait(1)
      const proposalId2 = proposeReceipt2.events![0].args!.proposalId

      // Check proposal states
      expect(await governor.state(proposalId)).to.equal(ProposalState.Active)
      expect(await governor.state(proposalId2)).to.equal(ProposalState.Pending)

      // Perform new stake addr3 should double up on voting weight due to new StRSR exchange rate
      // Stake RSR with addr3 - And delegate
      await rsr.connect(addr3).approve(stRSRVotes.address, stkAmt1)
      await stRSRVotes.connect(addr3).stake(stkAmt1)
      await stRSRVotes.connect(addr3).delegate(addr3.address)

      // Advance time to start voting 2nd proposal
      await advanceBlocks(VOTING_DELAY + 1)

      const snapshotBlock2 = (await getLatestBlockTimestamp()) - 1

      // Check proposal states
      expect(await governor.state(proposalId)).to.equal(ProposalState.Active)
      expect(await governor.state(proposalId2)).to.equal(ProposalState.Active)

      // Check votes being used for each proposal
      // Proposal 1
      expect(await governor.getVotes(addr1.address, snapshotBlock1)).to.equal(stkAmt1)
      expect(await governor.getVotes(addr2.address, snapshotBlock1)).to.equal(stkAmt1)
      expect(await governor.getVotes(addr3.address, snapshotBlock1)).to.equal(0)

      // Proposal 2
      expect(await governor.getVotes(addr1.address, snapshotBlock2)).to.equal(stkAmt1)
      expect(await governor.getVotes(addr2.address, snapshotBlock2)).to.equal(stkAmt1)
      expect(await governor.getVotes(addr3.address, snapshotBlock2)).to.equal(stkAmt1.mul(2))

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
      await expect(
        governor
          .connect(addr1)
          .queue([backingManager.address], [0], [encodedFunctionCall], proposalDescHash)
      ).to.be.revertedWith('Governor: proposal not successful')

      // Queue proposal #2
      await governor
        .connect(addr1)
        .queue([main.address], [0], [newEncodedFunctionCall], proposalDescHash2)

      // Check proposal state
      expect(await governor.state(proposalId2)).to.equal(ProposalState.Queued)

      // Advance time required by timelock
      await advanceTime(MIN_DELAY + 1)
      await advanceBlocks(1)

      // Execute proposal 2
      await governor
        .connect(addr1)
        .execute([main.address], [0], [newEncodedFunctionCall], proposalDescHash2)

      // Check proposal state
      expect(await governor.state(proposalId2)).to.equal(ProposalState.Executed)

      // Check role was granted
      expect(await main.hasRole(SHORT_FREEZER, other.address)).to.equal(true)
    })

    it('Should allow to update GovernorSettings via governance', async () => {
      // Attempt to update if not governance
      await expect(governor.setVotingDelay(bn(172800))).to.be.revertedWith(
        'Governor: onlyGovernance'
      )

      // Attempt to update without governance process in place
      await whileImpersonating(timelock.address, async (signer) => {
        await expect(governor.connect(signer).setVotingDelay(bn(172800))).to.be.reverted
      })

      // Update votingDelay via proposal
      encodedFunctionCall = governor.interface.encodeFunctionData('setVotingDelay', [
        VOTING_DELAY * 2,
      ])
      proposalDescription = 'Proposal #2 - Update Voting Delay to double'
      proposalDescHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(proposalDescription))

      // Check current value
      expect(await governor.votingDelay()).to.equal(VOTING_DELAY)

      // Propose
      const proposeTx = await governor
        .connect(addr1)
        .propose([governor.address], [0], [encodedFunctionCall], proposalDescription)

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

      // Advance time till voting is complete
      await advanceBlocks(VOTING_PERIOD + 1)

      // Finished voting - Check proposal state
      expect(await governor.state(proposalId)).to.equal(ProposalState.Succeeded)

      // Queue proposal
      await governor
        .connect(addr1)
        .queue([governor.address], [0], [encodedFunctionCall], proposalDescHash)

      // Check proposal state
      expect(await governor.state(proposalId)).to.equal(ProposalState.Queued)

      // Advance time required by timelock
      await advanceTime(MIN_DELAY + 1)
      await advanceBlocks(1)

      // Execute
      await governor
        .connect(addr1)
        .execute([governor.address], [0], [encodedFunctionCall], proposalDescHash)

      // Check proposal state
      expect(await governor.state(proposalId)).to.equal(ProposalState.Executed)

      //  Check value was updated
      expect(await governor.votingDelay()).to.equal(VOTING_DELAY * 2)
    })

    it('Should perform validations on votingDelay when updating', async () => {
      // Update via proposal - Invalid value
      encodedFunctionCall = governor.interface.encodeFunctionData('setVotingDelay', [bn(7100)])
      proposalDescription = 'Proposal #2 - Update Voting Delay to invalid'
      proposalDescHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(proposalDescription))

      // Check current value
      expect(await governor.votingDelay()).to.equal(VOTING_DELAY)

      // Propose
      const proposeTx = await governor
        .connect(addr1)
        .propose([governor.address], [0], [encodedFunctionCall], proposalDescription)

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

      // Advance time till voting is complete
      await advanceBlocks(VOTING_PERIOD + 1)

      // Finished voting - Check proposal state
      expect(await governor.state(proposalId)).to.equal(ProposalState.Succeeded)

      // Queue proposal
      await governor
        .connect(addr1)
        .queue([governor.address], [0], [encodedFunctionCall], proposalDescHash)

      // Check proposal state
      expect(await governor.state(proposalId)).to.equal(ProposalState.Queued)

      // Advance time required by timelock
      await advanceTime(MIN_DELAY + 1)
      await advanceBlocks(1)

      // Execute
      await expect(
        governor
          .connect(addr1)
          .execute([governor.address], [0], [encodedFunctionCall], proposalDescHash)
      ).to.be.revertedWith('TimelockController: underlying transaction reverted')

      // Check proposal state, still queued
      expect(await governor.state(proposalId)).to.equal(ProposalState.Queued)

      //  Check value was not updated
      expect(await governor.votingDelay()).to.equal(VOTING_DELAY)
    })
  })
})
