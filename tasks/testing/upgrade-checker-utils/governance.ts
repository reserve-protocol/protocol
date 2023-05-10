import { ProposalState } from "#/common/constants"
import { bn } from "#/common/numbers"
import { whileImpersonating } from "#/utils/impersonation"
import { Delegate, Proposal, getDelegates, getProposalDetails } from "#/utils/subgraph"
import { advanceBlocks, advanceTime } from "#/utils/time"
import { BigNumber, PopulatedTransaction } from "ethers"
import { HardhatRuntimeEnvironment } from "hardhat/types"

export const passAndExecuteProposal = async (
  hre: HardhatRuntimeEnvironment,
  rtokenAddress: string,
  governorAddress: string,
  proposalId: string,
  proposal?: Proposal
) => {
  console.log(`\nPassing & executing proposal ${proposalId}...`)
  const governor = await hre.ethers.getContractAt('Governance', governorAddress)

  // Check proposal state
  let propState = await governor.state(proposalId)
  if (propState == ProposalState.Pending) {
    console.log(`Prop ${proposalId} is PENDING, moving to ACTIVE...`)

    // Advance time to start voting
    const votingDelay = await governor.votingDelay()
    await advanceBlocks(hre, votingDelay.add(1))
  
    // Check proposal state
    propState = await governor.state(proposalId)
    if (propState != ProposalState.Active) {
      throw new Error(`Proposal should be active but was ${propState}`)
    }
  }

  if (propState == ProposalState.Active) {
    console.log(`Prop ${proposalId} is ACTIVE, moving to SUCCEEDED...`)

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
  
    // Advance time till voting is complete
    const votingPeriod = await governor.votingPeriod()
    await advanceBlocks(hre, votingPeriod.add(1))

    propState = await governor.state(proposalId)
    // Finished voting - Check proposal state
    if (propState != ProposalState.Succeeded) {
      throw new Error('Proposal should have succeeded')
    }
  }

  let descriptionHash: string

  if (propState == ProposalState.Succeeded) {
    console.log(`Prop ${proposalId} is SUCCEEDED, moving to QUEUED...`)

    if (!proposal) {
      proposal = await getProposalDetails(
        `${governorAddress.toLowerCase()}-${proposalId}`
      )
    }
    descriptionHash = hre.ethers.utils.keccak256(
      hre.ethers.utils.toUtf8Bytes(proposal.description)
    )
    // Queue propoal
    await governor.queue(proposal.targets, proposal.values, proposal.calldatas, descriptionHash)
  
    // Check proposal state
    propState = await governor.state(proposalId)
    if (propState != ProposalState.Queued) {
      throw new Error('Proposal should be queued')
    }
  }

  if (propState == ProposalState.Queued) {
    console.log(`Prop ${proposalId} is QUEUED, moving to EXECUTED...`)

    if (!proposal) {
      proposal = await getProposalDetails(
        `${governorAddress.toLowerCase()}-${proposalId}`
      )
    }
    descriptionHash = hre.ethers.utils.keccak256(
      hre.ethers.utils.toUtf8Bytes(proposal.description)
    )

    const timelock = await hre.ethers.getContractAt('TimelockController', await governor.timelock())
    const minDelay = await timelock.getMinDelay()
  
    // Advance time required by timelock
    await advanceTime(hre, minDelay.add(1).toString())
    await advanceBlocks(hre, 1)
  
    // Execute
    await governor.execute(proposal.targets, proposal.values, proposal.calldatas, descriptionHash)

    // Check proposal state
    propState = await governor.state(proposalId)
    if (propState != ProposalState.Executed) {
      throw new Error('Proposal should be executed')
    }
  }

  console.log(`Prop ${proposalId} is EXECUTED.`)
}
  
export const stakeAndDelegateRsr = async (
  hre: HardhatRuntimeEnvironment,
  rtokenAddress: string,
  governorAddress: string,
  user: string
) => {
  const governor = await hre.ethers.getContractAt('Governance', governorAddress)
  const rToken = await hre.ethers.getContractAt('RTokenP1', rtokenAddress)
  const main = await hre.ethers.getContractAt('IMain', await rToken.main())
  const stRSR = await hre.ethers.getContractAt(
    'StRSRP1Votes',
    await main.stRSR()
  )
  const rsr = await hre.ethers.getContractAt(
    'StRSRP1Votes',
    await main.rsr()
  )

  await whileImpersonating(hre, user, async (signer) => {
    const bal = await rsr.balanceOf(signer.address)
    await rsr.approve(stRSR.address, bal)
    await stRSR.stake(bal)
    await stRSR.delegate(signer.address)
  })
}

export const buildProposal = (txs: Array<PopulatedTransaction>, description: string): Proposal => {
  const targets = txs.map((tx: PopulatedTransaction) => tx.to!)
  const values = txs.map((tx: PopulatedTransaction) => bn(0))
  const calldatas = txs.map((tx: PopulatedTransaction) => tx.data!)
  return {
    targets,
    values,
    calldatas,
    description
  }
}

export type ProposalBuilder = (hre: HardhatRuntimeEnvironment, rTokenAddress: string, governorAddress: string) => Promise<Proposal>

export const proposeUpgrade = async (
  hre: HardhatRuntimeEnvironment,
  rTokenAddress: string,
  governorAddress: string,
  proposalBuilder: ProposalBuilder
): Promise<Proposal> => {
  console.log(`\nGenerating and proposing proposal...`)
  const [tester] = await hre.ethers.getSigners()

  await hre.run("give-rsr", {address: tester.address})
  await stakeAndDelegateRsr(hre, rTokenAddress, governorAddress, tester.address)

  const proposal = await proposalBuilder(hre, rTokenAddress, governorAddress)
  
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

  return { ...proposal, proposalId: resp.events![0].args!.proposalId}
}