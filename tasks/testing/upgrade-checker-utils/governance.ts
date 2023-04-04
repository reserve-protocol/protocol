import { ProposalState } from "#/common/constants"
import { whileImpersonating } from "#/utils/impersonation"
import { Delegate, Proposal, getDelegates, getProposalDetails } from "#/utils/subgraph"
import { advanceBlocks, advanceTime } from "#/utils/time"
import { BigNumber } from "ethers"
import { HardhatRuntimeEnvironment } from "hardhat/types"

export const passAndExecuteProposal = async (
  hre: HardhatRuntimeEnvironment,
  rtokenAddress: string,
  governorAddress: string,
  proposalId: string
) => {
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

  let proposal: Proposal
  let descriptionHash: string

  if (propState == ProposalState.Succeeded) {
    console.log(`Prop ${proposalId} is SUCCEEDED, moving to QUEUED...`)

    proposal = await getProposalDetails(
      `${governorAddress.toLowerCase()}-${proposalId}`
    )
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

    proposal = await getProposalDetails(
      `${governorAddress.toLowerCase()}-${proposalId}`
    )
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
  