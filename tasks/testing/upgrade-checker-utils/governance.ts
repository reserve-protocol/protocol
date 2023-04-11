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
  proposalId: string,
  proposal?: Proposal
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

export const proposeUpgrade = async (hre: HardhatRuntimeEnvironment, rTokenAddress: string, governorAddress: string): Promise<Proposal> => {
  const [tester] = await hre.ethers.getSigners()

  await hre.run("give-rsr", {address: tester.address})
  await stakeAndDelegateRsr(hre, rTokenAddress, governorAddress, tester.address)

  const rToken = await hre.ethers.getContractAt('RTokenP1', rTokenAddress)
  const main = await hre.ethers.getContractAt('IMain', await rToken.main())
  const broker = await hre.ethers.getContractAt(
    'BrokerP1',
    await main.broker()
  )
  const stRSR = await hre.ethers.getContractAt(
    'StRSRP1Votes',
    await main.stRSR()
  )
  const basketHandler = await hre.ethers.getContractAt(
    'BasketHandlerP1',
    await main.basketHandler()
  )

  const votes = await stRSR.getVotes(tester.address)
  console.log('votes', votes)

  const targets = [
    broker.address,
    stRSR.address,
    basketHandler.address,
    rToken.address,
    broker.address
  ]

  const values = [
    bn(0),
    bn(0),
    bn(0),
    bn(0),
    bn(0)
  ]

  const calldatas = [
    (await broker.populateTransaction.upgradeTo("0x89209a52d085D975b14555F3e828F43fb7EaF3B7")).data!,
    (await stRSR.populateTransaction.upgradeTo("0xfDa8C62d86E426D5fB653B6c44a455Bb657b693f")).data!,
    (await basketHandler.populateTransaction.upgradeTo("0x5c13b3b6f40aD4bF7aa4793F844BA24E85482030")).data!,
    (await rToken.populateTransaction.upgradeTo("0x5643D5AC6b79ae8467Cf2F416da6D465d8e7D9C1")).data!,
    (await broker.populateTransaction.setTradeImplementation("0xAd4B0B11B041BB1342fEA16fc9c12Ef2a6443439")).data!
  ]

  console.log('calldatas', calldatas)

  const description = "release 2.1.0 test"

  const governor = await hre.ethers.getContractAt('Governance', governorAddress)

  const call = await governor.populateTransaction.propose(targets, values, calldatas, description)

  const r = await governor.propose(targets, values, calldatas, description)
  const resp = await r.wait()

  console.log(`proposed: ${resp.events![0].args!.proposalId}`)
  return {
    targets,
    values,
    calldatas,
    description,
    proposalId: resp.events![0].args!.proposalId
  }
}