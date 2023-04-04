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
    if (propState != ProposalState.Pending) {
      throw new Error(`Proposal should be pending but was ${propState}`)
    }
  
    // Advance time to start voting
    const votingDelay = await governor.votingDelay()
    await advanceBlocks(hre, votingDelay.add(1))
  
    // Check proposal state
    propState = await governor.state(proposalId)
    if (propState != ProposalState.Active) {
      throw new Error(`Proposal should be active but was ${propState}`)
    }
  
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
  
    // Finished voting - Check proposal state
    if ((await governor.state(proposalId)) != ProposalState.Succeeded) {
      throw new Error('Proposal should have succeeded')
    }
  
    const proposal: Proposal = await getProposalDetails(
      `${governorAddress.toLowerCase()}-${proposalId}`
    )
    const descriptionHash = hre.ethers.utils.keccak256(
      hre.ethers.utils.toUtf8Bytes(proposal.description)
    )
    // Queue propoal
    await governor.queue(proposal.targets, proposal.values, proposal.calldatas, descriptionHash)
  
    // Check proposal state
    if ((await governor.state(proposalId)) != ProposalState.Queued) {
      throw new Error('Proposal should be queued')
    }
  
    const timelock = await hre.ethers.getContractAt('TimelockController', await governor.timelock())
    const minDelay = await timelock.getMinDelay()
  
    // Advance time required by timelock
    await advanceTime(hre, minDelay.add(1).toString())
    await advanceBlocks(hre, 1)
  
    // Execute
    await governor.execute(proposal.targets, proposal.values, proposal.calldatas, descriptionHash)
  
    // Check proposal state
    if ((await governor.state(proposalId)) != ProposalState.Executed) {
      throw new Error('Proposal should be executed')
    }
  }
  