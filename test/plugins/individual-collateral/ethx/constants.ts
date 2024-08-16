import { bn, fp } from '../../../../common/numbers'
import { networkConfig } from '../../../../common/configuration'

// Mainnet Addresses
export const RSR = networkConfig['31337'].tokens.RSR as string
export const ETH_USD_PRICE_FEED = networkConfig['31337'].chainlinkFeeds.ETH as string
export const ETHx = networkConfig['31337'].tokens.ETHx as string
export const WETH = networkConfig['31337'].tokens.WETH as string
export const ETHx_WHALE = '0x9d7eD45EE2E8FC5482fa2428f15C971e6369011d'
export const STADER_ORACLE = '0xF64bAe65f6f2a5277571143A24FaaFDFC0C2a737'

export const ETHx_ETH_PRICE_FEED = networkConfig['31337'].chainlinkFeeds.ETHx as string

export const PRICE_TIMEOUT = bn('604800') // 1 week
export const ETH_ORACLE_TIMEOUT = bn(3600) // 1 hour in seconds
export const ETH_ORACLE_ERROR = fp('0.005')
export const ETHX_ORACLE_ERROR = fp('0.005')
export const ETHX_ORACLE_TIMEOUT = bn(86400) // 24 hours in seconds

export const DEFAULT_THRESHOLD = bn(5).mul(bn(10).pow(16)) // 0.05
export const DELAY_UNTIL_DEFAULT = bn(86400)
export const MAX_TRADE_VOL = bn(1000)

export const FORK_BLOCK = 20452594
