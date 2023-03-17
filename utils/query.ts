import { ethers } from 'hardhat'
import { BigNumber, BigNumberish } from 'ethers'
import { request, gql, GraphQLClient } from 'graphql-request'
import { useEnv } from './env';

export interface Whale {
    address: string,
    amount: BigNumberish
}

export const getWhales = async (governance: string): Promise<Array<Whale>> => {
    const governor = await ethers.getContractAt('Governance', governance)
    const stRSR = await governor.token()
    return []
}

export interface Proposal {
    targets: Array<string>
    values: Array<BigNumber>
    calldatas: Array<string>
    descriptionHash: string
}

export const getProposalDetails = async (proposalId: string): Promise<Proposal> => {
    if (!useEnv('SUBGRAPH_URL')) {
        throw new Error('Please add a valid SUBGRAPH_URL to your .env')
    }
    const client = new GraphQLClient(useEnv('SUBGRAPH_URL'))
    const query = gql`
        query getProposalDetail($id: String!) {
            proposal(id: $id) {
            id
            description
            creationTime
            startBlock
            endBlock
            queueBlock
            state
            executionStartBlock
            executionETA
            calldatas
            targets
            proposer {
                address
            }
            votes {
                choice
                voter {
                address
                }
                weight
            }
            forWeightedVotes
            againstWeightedVotes
            abstainWeightedVotes
            quorumVotes
            forDelegateVotes
            abstainDelegateVotes
            againstDelegateVotes
            }
        }
    `
    const prop: Proposal = await client.request(query, { id: proposalId })
    console.log('resp', prop)
    return prop
}