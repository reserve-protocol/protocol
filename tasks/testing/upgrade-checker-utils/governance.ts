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
    await advanceBlocks(hre, votingDelay.add(2))
  } else {
    if (propState == ProposalState.Active) {
      console.log(`Proposal is already ${ProposalState[ProposalState.Active]}... skipping step.`)
    } else {
      throw Error(`Proposal should be ${ProposalState[ProposalState.Pending]} at this step.`)
    }
  }

  await validatePropState(await governor.state(proposalId), ProposalState.Active)
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
      const startBlock = await governor.proposalSnapshot(proposalId)
      const quorum = await governor.quorum(startBlock)

      let quorumNotReached = true
      let currentVoteAmount = BigNumber.from(0)
      let i = 0
      while (quorumNotReached) {
        const whale = whales[i]
        currentVoteAmount = currentVoteAmount.add(BigNumber.from(whale.delegatedVotesRaw))
        i += 1
        if (currentVoteAmount.gt(quorum)) {
          quorumNotReached = false
        }
      }

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

  await validatePropState(await governor.state(proposalId), ProposalState.Active)
}

export const passProposal = async (
  hre: HardhatRuntimeEnvironment,
  rtokenAddress: string,
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

  await validatePropState(await governor.state(proposalId), ProposalState.Succeeded)
}

export const executeProposal = async (
  hre: HardhatRuntimeEnvironment,
  rtokenAddress: string,
  governorAddress: string,
  proposalId: string,
  proposal?: Proposal,
  extraAssets: string[] = []
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
    await pushOraclesForward(hre, rtokenAddress, extraAssets)

    console.log('Executing now...')

    // Execute
    await governor.execute(proposal.targets, proposal.values, proposal.calldatas, descriptionHash)

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
    await rsr.approve(stRSR.address, bal)
    await stRSR.stake(bal)
    await stRSR.delegate(signer.address)
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
  governorAddress: string
) => Promise<Proposal>

export const proposeUpgrade = async (
  hre: HardhatRuntimeEnvironment,
  rTokenAddress: string,
  governorAddress: string,
  proposal: Proposal
) => {
  console.log(`\nGenerating and proposing proposal...`)
  const [tester] = await hre.ethers.getSigners()

  await hre.run('give-rsr', { address: tester.address })
  await stakeAndDelegateRsr(hre, rTokenAddress, tester.address)

  const governor = await hre.ethers.getContractAt('Governance', governorAddress)

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

  console.log('\nSuccessfully proposed!')
  console.log(`Proposal ID: ${resp.events![0].args!.proposalId}`)

  return {
    ...proposal,
    proposalId: resp.events![0].args!.proposalId as string,
  }
}
