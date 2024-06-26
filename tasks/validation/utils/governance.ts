import { ProposalState } from '#/common/constants'
import { bn } from '#/common/numbers'
import { whileImpersonating } from '#/utils/impersonation'
import { Delegate, Proposal, getDelegates, getProposalDetails } from '#/utils/subgraph'
import { advanceBlocks, advanceTime } from '#/utils/time'
import { BigNumber, PopulatedTransaction } from 'ethers'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { pushOraclesForward } from './oracles'

const validatePropState = async (propState: ProposalState, expectedState: ProposalState) => {
  if (propState !== expectedState) {
    throw new Error(
      `Proposal should be ${ProposalState[expectedState]} but was ${ProposalState[propState]}`
    )
  }
}

export const moveProposalToActive = async (
  hre: HardhatRuntimeEnvironment,
  rtokenAddress: string,
  governorAddress: string,
  proposalId: string
) => {
  console.log('Activating Proposal:', proposalId)

  const governor = await hre.ethers.getContractAt('Governance', governorAddress)
  const propState = await governor.state(proposalId)

  if (propState == ProposalState.Pending) {
    console.log(`Proposal is PENDING, moving to ACTIVE...`)

    // Advance time to start voting
    const votingDelay = await governor.votingDelay()
    const rToken = await hre.ethers.getContractAt('RTokenP1', rtokenAddress)
    const version = await rToken.version()
    if (version == '3.0.0' || version == '3.0.1') await advanceBlocks(hre, votingDelay.add(2))
    else await advanceTime(hre, votingDelay.add(2).toNumber())
  } else if (propState == ProposalState.Active) {
    console.log(`Proposal is already ${ProposalState[ProposalState.Active]}... skipping step.`)
  }

  const state = await governor.state(proposalId)
  if (![ProposalState.Active, ProposalState.Succeeded, ProposalState.Queued].includes(state)) {
    throw new Error(`Proposal is in unexpected state ${ProposalState[propState]}`)
  }
}

export const voteProposal = async (
  hre: HardhatRuntimeEnvironment,
  rtokenAddress: string,
  governorAddress: string,
  proposalId: string,
  proposal?: Proposal
) => {
  console.log('Voting Proposal:', proposalId)

  const governor = await hre.ethers.getContractAt('Governance', governorAddress)
  const propState = await governor.state(proposalId)

  if (propState == ProposalState.Active) {
    console.log(`Proposal is ACTIVE, moving to SUCCEEDED...`)

    if (!proposal) {
      // gather enough whale voters
      let whales: Array<Delegate> = await getDelegates(rtokenAddress.toLowerCase())
      const quorum = await governor.quorum(await governor.proposalSnapshot(proposalId))

      let quorumNotReached = true
      let currentVoteAmount = BigNumber.from(0)
      let i = 0
      while (quorumNotReached) {
        const whale = whales[i]
        if (!whale) throw new Error(`missing whale at index ${i} for RToken ${rtokenAddress}`)
        currentVoteAmount = currentVoteAmount.add(BigNumber.from(whale.delegatedVotesRaw))
        i += 1
        console.log(`Votes: ${currentVoteAmount} / ${quorum}`)
        if (currentVoteAmount.gt(quorum)) {
          quorumNotReached = false
        }
      }
      if (quorumNotReached) throw new Error('quorum not reached')

      whales = whales.slice(0, i)

      // cast enough votes to pass the proposal
      for (const whale of whales) {
        await whileImpersonating(hre, whale.address, async (signer) => {
          await governor.connect(signer).castVote(proposalId, 1)
        })
      }
    } else {
      // Vote from testing account, on the assumption it is staked/delegated
      const [tester] = await hre.ethers.getSigners()
      await governor.connect(tester).castVote(proposalId, 1)
    }
  }

  const state = await governor.state(proposalId)
  if (![ProposalState.Active, ProposalState.Succeeded, ProposalState.Queued].includes(state)) {
    throw new Error(`Proposal is in unexpected state ${ProposalState[propState]}`)
  }
}

export const passProposal = async (
  hre: HardhatRuntimeEnvironment,
  governorAddress: string,
  proposalId: string
) => {
  console.log('Passing Proposal:', proposalId)

  const governor = await hre.ethers.getContractAt('Governance', governorAddress)
  const propState = await governor.state(proposalId)

  if (propState == ProposalState.Active) {
    // Advance time till voting is complete
    const votingPeriod = await governor.votingPeriod()
    await advanceBlocks(hre, votingPeriod.add(1))
  }

  const state = await governor.state(proposalId)
  if (![ProposalState.Succeeded, ProposalState.Queued].includes(state)) {
    throw new Error(`Proposal is in unexpected state ${ProposalState[propState]}`)
  }
}

export const executeProposal = async (
  hre: HardhatRuntimeEnvironment,
  rtokenAddress: string,
  governorAddress: string,
  proposalId: string,
  proposal?: Proposal
) => {
  console.log('Executing Proposal:', proposalId)
  const governor = await hre.ethers.getContractAt('Governance', governorAddress)

  // Check proposal state
  let propState = await governor.state(proposalId)

  let descriptionHash: string

  if (propState == ProposalState.Succeeded) {
    console.log(`Proposal is SUCCEEDED, moving to QUEUED...`)

    if (!proposal) {
      proposal = await getProposalDetails(proposalId)
    }

    descriptionHash = hre.ethers.utils.keccak256(hre.ethers.utils.toUtf8Bytes(proposal.description))
    // Queue proposal
    await governor.queue(proposal.targets, proposal.values, proposal.calldatas, descriptionHash)

    // Check proposal state
    propState = await governor.state(proposalId)
    await validatePropState(propState, ProposalState.Queued)
  }

  if (propState == ProposalState.Queued) {
    console.log(`Proposal is QUEUED, moving to EXECUTED...`)

    if (!proposal) {
      proposal = await getProposalDetails(`${governorAddress.toLowerCase()}-${proposalId}`)
    }

    descriptionHash = hre.ethers.utils.keccak256(hre.ethers.utils.toUtf8Bytes(proposal.description))

    const timelock = await hre.ethers.getContractAt('TimelockController', await governor.timelock())
    const minDelay = await timelock.getMinDelay()

    console.log('Preparing execution...')
    // Advance time required by timelock
    await advanceTime(hre, minDelay.add(1).toString())
    await advanceBlocks(hre, 1)

    /*
     ** Executing proposals requires that the oracles aren't stale.
     ** Make sure to specify any extra assets that may have been registered.
     */

    await pushOraclesForward(hre, rtokenAddress, [])

    console.log('Executing now...')

    // Execute
    const tx = await governor.execute(
      proposal.targets,
      proposal.values,
      proposal.calldatas,
      descriptionHash
    )
    const receipt = await tx.wait()
    console.log('Gas Used:', receipt.gasUsed.toString())

    propState = await governor.state(proposalId)
    await validatePropState(propState, ProposalState.Executed)
  } else {
    throw new Error('Proposal should be queued')
  }

  console.log(`Proposal is EXECUTED.`)
}

export const stakeAndDelegateRsr = async (
  hre: HardhatRuntimeEnvironment,
  rtokenAddress: string,
  user: string
) => {
  const rToken = await hre.ethers.getContractAt('RTokenP1', rtokenAddress)
  const main = await hre.ethers.getContractAt('IMain', await rToken.main())
  const stRSR = await hre.ethers.getContractAt('StRSRP1Votes', await main.stRSR())
  const rsr = await hre.ethers.getContractAt('StRSRP1Votes', await main.rsr())

  await whileImpersonating(hre, user, async (signer) => {
    const bal = await rsr.balanceOf(signer.address)
    await rsr.connect(signer).approve(stRSR.address, bal)
    await stRSR.connect(signer).stake(bal)
    await stRSR.connect(signer).delegate(signer.address)
  })
}

export const unstakeAndWithdrawRsr = async (
  hre: HardhatRuntimeEnvironment,
  rtokenAddress: string,
  user: string
) => {
  const rToken = await hre.ethers.getContractAt('RTokenP1', rtokenAddress)
  const main = await hre.ethers.getContractAt('IMain', await rToken.main())
  const stRSR = await hre.ethers.getContractAt('StRSRP1Votes', await main.stRSR())
  const unstakingDelay = await stRSR.unstakingDelay()

  await whileImpersonating(hre, user, async (signer) => {
    const bal = await stRSR.balanceOf(signer.address)
    await stRSR.connect(signer).unstake(bal)
    await advanceTime(hre, unstakingDelay + 2)
    await pushOraclesForward(hre, rToken.address, []) // required to withdraw
    await stRSR.connect(signer).withdraw(signer.address, 0)
  })
}

export const buildProposal = (txs: Array<PopulatedTransaction>, description: string): Proposal => {
  const targets = txs.map((tx: PopulatedTransaction) => tx.to!)
  const values = txs.map(() => bn(0))
  const calldatas = txs.map((tx: PopulatedTransaction) => tx.data!)
  return {
    targets,
    values,
    calldatas,
    description,
  }
}

export type ProposalBuilder = (
  hre: HardhatRuntimeEnvironment,
  rTokenAddress: string,
  governorAddress: string,
  timelockAddress: string
) => Promise<Proposal>

export const proposeUpgrade = async (
  hre: HardhatRuntimeEnvironment,
  rTokenAddress: string,
  governorAddress: string,
  proposal: Proposal
) => {
  console.log(`\nGenerating and proposing proposal...`)
  const [tester] = await hre.ethers.getSigners()

  const rToken = await hre.ethers.getContractAt('IRToken', rTokenAddress)
  const main = await hre.ethers.getContractAt('IMain', await rToken.main())
  const stRSR = await hre.ethers.getContractAt('StRSRP1Votes', await main.stRSR())
  const amount = (await stRSR.getStakeRSR()).div(100) // 1% increase in staked RSR
  const governor = await hre.ethers.getContractAt('Governance', governorAddress)

  let proposalId = await governor.hashProposal(
    proposal.targets,
    proposal.values,
    proposal.calldatas,
    await hre.ethers.utils.keccak256(hre.ethers.utils.toUtf8Bytes(proposal.description))
  )

  // Only propose if not already proposed
  if ((await governor.proposalSnapshot(proposalId)).eq(0)) {
    await hre.run('give-rsr', { address: tester.address, amount: amount.toString() })
    await stakeAndDelegateRsr(hre, rTokenAddress, tester.address)

    const call = await governor.populateTransaction.propose(
      proposal.targets,
      proposal.values,
      proposal.calldatas,
      proposal.description
    )

    console.log(`Proposal Transaction:\n`, call.data)

    const r = await governor.propose(
      proposal.targets,
      proposal.values,
      proposal.calldatas,
      proposal.description
    )
    const resp = await r.wait()
    proposalId = bn(resp.events![0].args!.proposalId)

    await validatePropState(await governor.state(proposalId), ProposalState.Pending)
    console.log('\nSuccessfully proposed!')
  } else {
    console.log('\nAlready proposed!')
  }

  console.log(`Proposal ID: ${proposalId}`)

  return {
    ...proposal,
    proposalId: proposalId.toString(),
  }
}
