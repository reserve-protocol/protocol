import dotenv from 'dotenv'

dotenv.config()

type IEnvVars =
  | 'MAINNET_RPC_URL'
  | 'ALCHEMY_MAINNET_RPC_URL'
  | 'GOERLI_RPC_URL'
  | 'MNEMONIC'
  | 'REPORT_GAS'
  | 'FORK'
  | 'SLOW'
  | 'PROTO'
  | 'PROTO_IMPL'
  | 'ETHERSCAN_API_KEY'
  | 'NO_OPT'
  | 'MAINNET_BLOCK'
  | 'ONLY_FAST'
  | 'JOBS'
  | 'EXTREME'
  | 'SUBGRAPH_URL'
  | 'TENDERLY_RPC_URL'

export function useEnv(key: IEnvVars | IEnvVars[], _default = ''): string {
  if (typeof key === 'string') {
    return process.env[key] ?? _default
  }
  if (typeof key === 'object') {
    for (const s of key) {
      if (process.env[s]) {
        return process.env[s]!
      }
    }
  }
  return _default
}
