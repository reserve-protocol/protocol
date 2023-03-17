import { task, types } from 'hardhat/config'
import { networkConfig } from '../../common/configuration'
import { getChainId } from '../../common/blockchain-utils'
import { advanceBlocks, advanceTime } from '#/utils/time'
import { whileImpersonating } from '#/utils/impersonation';
import { ProposalState } from '#/common/constants'
import { BigNumber } from 'ethers'
import { Proposal, getProposalDetails, getDelegates, Delegate } from '../../utils/subgraph'
import { useEnv } from '#/utils/env';
import { resetFork } from '#/utils/chain';

task('upgrade-checker', 'Mints all the tokens to an address')
    .addParam('rtoken', 'the address of the RToken being upgraded')
    .addParam('governor', 'the address of the OWNER of the RToken being upgraded')
    .addParam('proposal', 'the ID of the governance proposal')
    .setAction(async (params, hre) => {
        await resetFork(hre, Number(useEnv('MAINNET_BLOCK')))
        const [deployer] = await hre.ethers.getSigners()

        const chainId = await getChainId(hre)

        // ********** Read config **********
        if (!networkConfig[chainId]) {
            throw new Error(`Missing network configuration for ${hre.network.name}`)
        }

        if (hre.network.name != 'localhost' && hre.network.name != 'hardhat') {
            throw new Error('Only run this on a local fork')
        }

        const rtoken = await hre.ethers.getContractAt('RTokenP1', params.rtoken)

        // 1. Approve and execute the govnerance proposal
        const governor = await hre.ethers.getContractAt('Governance', params.governor)
        const proposalId = params.proposal

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
        let whales: Array<Delegate> = await getDelegates(hre, params.rtoken.toLowerCase())
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
        if (await governor.state(proposalId) != ProposalState.Succeeded) {
            throw new Error("Proposal should have succeeded")
        }

        const proposal: Proposal = await getProposalDetails(hre, `${params.governor.toLowerCase()}-${params.proposal}`)
        const descriptionHash = hre.ethers.utils.keccak256(hre.ethers.utils.toUtf8Bytes(proposal.description))
        // Queue propoal
        await governor.queue(
            proposal.targets,
            proposal.values,
            proposal.calldatas,
            descriptionHash
        )

        // Check proposal state
        if (await governor.state(proposalId) != ProposalState.Queued) {
            throw new Error("Proposal should be queued")
        }

        const timelock = await hre.ethers.getContractAt('TimelockController', await governor.timelock())
        const minDelay = await timelock.getMinDelay()

        // Advance time required by timelock
        await advanceTime(hre, minDelay.add(1).toString())
        await advanceBlocks(hre, 1)

        // Execute
        await governor.execute(
            proposal.targets,
            proposal.values,
            proposal.calldatas,
            descriptionHash
        )

        // Check proposal state
        if (await governor.state(proposalId) != ProposalState.Executed) {
            throw new Error("Proposal should be executed")
        }

        // 2. Run various checks
    })
