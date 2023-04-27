import { BigNumber, BigNumberish } from 'ethers'
import { gql, GraphQLClient } from 'graphql-request'
import { useEnv } from './env'

export interface Delegate {
  delegatedVotesRaw: BigNumberish
  address: string
}

export const getDelegates = async (governance: string): Promise<Array<Delegate>> => {
  const client = new GraphQLClient(useEnv('SUBGRAPH_URL'))
  const query = gql`
    query getDelegates($governance: String!) {
      delegates(
        where: { governance: $governance }
        orderBy: delegatedVotesRaw
        orderDirection: desc
        first: 20
      ) {
        id
        delegatedVotesRaw
        address
      }
    }
  `
  const whales = await client.request(query, { governance })
  return whales.delegates
}

export interface Proposal {
  targets: Array<string>
  values: Array<BigNumber>
  calldatas: Array<string>
  description: string
  proposalId?: string
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
        calldatas
        targets
        values
        description
      }
    }
  `
  const prop = await client.request(query, { id: proposalId })
  return prop.proposal
}
