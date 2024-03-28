import { bn, fp } from '../../../../common/numbers'
import { networkConfig } from '../../../../common/configuration'
import { useEnv } from '#/utils/env'

export const forkNetwork = useEnv('FORK_NETWORK') ?? 'mainnet'
let chainId

switch (forkNetwork) {
  case 'mainnet':
    chainId = '1'
    break
  case 'base':
    chainId = '8453'
    break
  case 'arbitrum':
    chainId = '42161'
    break
  default:
    chainId = '1'
    break
}

const USDC_NAME = 'USDC'
const CUSDC_NAME = 'cUSDCv3'
const USDC_HOLDERS: { [key: string]: string } = {
  '1': '0x0a59649758aa4d66e25f08dd01271e891fe52199',
  '8453': '0xcdac0d6c6c59727a65f871236188350531885c43',
  '42161': '0x2df1c51e09aecf9cacb7bc98cb1742757f163df7',
}
const FORK_BLOCKS: { [key: string]: number } = {
  '1': 15850930,
  '8453': 12292893,
  '42161': 193157126,
}

// Mainnet Addresses
export const RSR = networkConfig[chainId].tokens.RSR as string
export const USDC_USD_PRICE_FEED = networkConfig[chainId].chainlinkFeeds.USDC as string
export const CUSDC_V3 = networkConfig[chainId].tokens[CUSDC_NAME]!
export const COMP = networkConfig[chainId].tokens.COMP as string
export const REWARDS = networkConfig[chainId].COMET_REWARDS!
export const USDC = networkConfig[chainId].tokens[USDC_NAME]!
export const USDC_HOLDER = USDC_HOLDERS[chainId]
export const COMET_CONFIGURATOR = networkConfig[chainId].COMET_CONFIGURATOR!
export const COMET_PROXY_ADMIN = networkConfig[chainId].COMET_PROXY_ADMIN!
export const COMET_EXT = networkConfig[chainId].COMET_EXT!

export const PRICE_TIMEOUT = bn(604800) // 1 week
export const ORACLE_TIMEOUT = bn(86400) // 24 hours in seconds
export const ORACLE_ERROR = fp('0.005')
export const DEFAULT_THRESHOLD = bn(5).mul(bn(10).pow(16)) // 0.05
export const DELAY_UNTIL_DEFAULT = bn(86400)
export const MAX_TRADE_VOL = bn(1000000)
export const USDC_DECIMALS = bn(6)

export const FORK_BLOCK = FORK_BLOCKS[chainId]
