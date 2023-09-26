import { useEnv } from './env'

const MAINNET_RPC_URL = useEnv(['MAINNET_RPC_URL', 'ALCHEMY_MAINNET_RPC_URL'])
const TENDERLY_RPC_URL = useEnv('TENDERLY_RPC_URL')
const GOERLI_RPC_URL = useEnv('GOERLI_RPC_URL')
const BASE_GOERLI_RPC_URL = useEnv('BASE_GOERLI_RPC_URL')
const BASE_RPC_URL = useEnv('BASE_RPC_URL')
export type Network = 'mainnet' | 'base'
export const forkRpcs = {
  'mainnet': MAINNET_RPC_URL,
  'base': BASE_RPC_URL,
}