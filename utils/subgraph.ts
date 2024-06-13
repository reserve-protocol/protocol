import { BigNumber, BigNumberish } from 'ethers'
import { gql, GraphQLClient } from 'graphql-request'
import { useEnv } from './env'
import { subgraphURLs, Network, validateSubgraphURL } from '#/utils/fork'

export interface Delegate {
  delegatedVotesRaw: BigNumberish
  address: string
}

export const getDelegates = async (governance: string): Promise<Array<Delegate>> => {
  const client = new GraphQLClient(subgraphURLs[(useEnv('FORK_NETWORK') as Network) ?? 'mainnet'])
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
  // @ts-expect-error Subgraphs are bad
  return whales.delegates
}

export interface Proposal {
  rtoken?: string
  governor?: string
  timelock?: string
  targets: Array<string>
  values: Array<BigNumber>
  calldatas: Array<string>
  description: string
  proposalId?: string
}

export const getProposalDetails = async (proposalId: string): Promise<Proposal> => {
  const network: Network = useEnv('FORK_NETWORK') as Network
  validateSubgraphURL(network)
  const subgraphURL = subgraphURLs[network]
  const client = new GraphQLClient(subgraphURL)
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
  // @ts-expect-error Subgraphs are bad
  return prop.proposal
}
