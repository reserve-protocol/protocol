import { task, types } from 'hardhat/config'
import { networkConfig } from '../../common/configuration'
import { getChainId } from '../../common/blockchain-utils'
import {
  getDeploymentFile,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
} from '../../scripts/deployment/common'
import {
    RTokenP1
} from '../../typechain'
import { ethers } from 'hardhat'
import { advanceBlocks, advanceTime } from '#/test/utils/time'
import { whileImpersonating } from '../../test/utils/impersonation';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { ProposalState } from '#/common/constants'
import { BigNumber, BigNumberish } from 'ethers'
import { Proposal, getProposalDetails } from '../../utils/query'

task('mint-tokens', 'Mints all the tokens to an address')
    .addParam('rtoken', 'the address of the RToken being upgraded')
    .addParam('governor', 'the address of the OWNER of the RToken being upgraded')
    .addParam('proposal', 'the ID of the governance proposal')
    .setAction(async (params, hre) => {
        const [deployer] = await hre.ethers.getSigners()

        const chainId = await getChainId(hre)

        // ********** Read config **********
        if (!networkConfig[chainId]) {
            throw new Error(`Missing network configuration for ${hre.network.name}`)
        }

        if (hre.network.name != 'localhost' && hre.network.name != 'hardhat') {
            throw new Error('Only run this on a local fork')
        }

        const rtoken: RTokenP1 = <RTokenP1>(await ethers.getContractAt('RTokenP1', params.rtoken))

        // 1. Approve and execute the govnerance proposal
        const governor = await ethers.getContractAt('Governance', params.governor)
        const proposalId = params.proposal

        // Check proposal state
        if (await governor.state(proposalId) != ProposalState.Pending) {
            throw new Error("Proposal should be pending")
        }

        // Advance time to start voting
        const votingDelay = await governor.votingDelay()
        await advanceBlocks(votingDelay.add(1))

        // Check proposal state
        if (await governor.state(proposalId) != ProposalState.Active) {
            throw new Error("Proposal should be active")
        }

        // gather enough whale voters
        let whales: Array<Whale> = await getWhales(params.governor)
        const startBlock = await governor.proposalSnapshot(proposalId)
        const quorum = await governor.quorum(startBlock)

        let quorumNotReached = true
        let currentVoteAmount = BigNumber.from(0)
        let i = 0
        while (quorumNotReached) {
            const whale = whales[i]
            currentVoteAmount = currentVoteAmount.add(whale.amount)
            i += 1
            if (currentVoteAmount.gt(quorum)) {
                quorumNotReached = false
            }
        }

        whales = whales.slice(0, i)

        // cast enough votes to pass the proposal
        for (const whale of whales) {
            whileImpersonating(whale.address, async (signer) => {
                await governor.connect(signer).castVote(proposalId, 1)
            })
        }
        
        // Advance time till voting is complete
        const votingPeriod = await governor.votingPeriod()
        await advanceBlocks(votingPeriod.add(1))

        // Finished voting - Check proposal state
        if (await governor.state(proposalId) != ProposalState.Succeeded) {
            throw new Error("Proposal should have succeeded")
        }

        const proposal: Proposal = await getProposalDetails(params.proposal)

        // Queue propoal
        await governor.queue(
            proposal.targets,
            proposal.values,
            proposal.calldatas,
            proposal.descriptionHash
        )

        // Check proposal state
        if (await governor.state(proposalId) != ProposalState.Queued) {
            throw new Error("Proposal should be queued")
        }

        const timelock = await ethers.getContractAt('TimelockController', await governor.timelock())
        const minDelay = await timelock.getMinDelay()

        // Advance time required by timelock
        await advanceTime(minDelay.add(1).toString())
        await advanceBlocks(1)

        // Execute
        await governor.execute(
            proposal.targets,
            proposal.values,
            proposal.calldatas,
            proposal.descriptionHash
        )

        // Check proposal state
        if (await governor.state(proposalId) != ProposalState.Executed) {
            throw new Error("Proposal should be executed")
        }

        // 2. Run various checks
    })
