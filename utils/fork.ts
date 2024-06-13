import { useEnv } from './env'

const MAINNET_RPC_URL = useEnv(['MAINNET_RPC_URL', 'ALCHEMY_MAINNET_RPC_URL'])
const TENDERLY_RPC_URL = useEnv('TENDERLY_RPC_URL')
const GOERLI_RPC_URL = useEnv('GOERLI_RPC_URL')
const BASE_GOERLI_RPC_URL = useEnv('BASE_GOERLI_RPC_URL')
const BASE_RPC_URL = useEnv('BASE_RPC_URL')
const ARBITRUM_RPC_URL = useEnv('ARBITRUM_RPC_URL')
const ARBITRUM_SEPOLIA_RPC_URL = useEnv('ARBITRUM_SEPOLIA_RPC_URL')
const MAINNET_SUBGRAPH_URL = useEnv('MAINNET_SUBGRAPH_URL')
const BASE_SUBGRAPH_URL = useEnv('BASE_SUBGRAPH_URL')
const ARBITRUM_SUBGRAPH_URL = useEnv('ARBITRUM_SUBGRAPH_URL')

export type Network = 'mainnet' | 'base' | 'arbitrum'
export const forkRpcs = {
  mainnet: MAINNET_RPC_URL,
  base: BASE_RPC_URL,
  arbitrum: ARBITRUM_RPC_URL,
}
export const subgraphURLs = {
  mainnet: MAINNET_SUBGRAPH_URL,
  base: BASE_SUBGRAPH_URL,
  arbitrum: ARBITRUM_SUBGRAPH_URL,
}

export const validateSubgraphURL = (network: Network) => {
  if (!subgraphURLs[network]) {
    throw new Error(`Valid ${network.toUpperCase()}_SUBGRAPH_URL required for subgraph queries`)
  }
}
