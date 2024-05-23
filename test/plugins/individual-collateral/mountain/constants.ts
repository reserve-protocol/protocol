import { bn, fp } from '../../../../common/numbers'
import { networkConfig } from '../../../../common/configuration'

// Mainnet Addresses
export const ARB_USDM = networkConfig['42161'].tokens.USDM as string
export const ARB_WUSDM = networkConfig['42161'].tokens.wUSDM as string
export const ARB_WUSDM_USD_PRICE_FEED = networkConfig['42161'].chainlinkFeeds.wUSDM as string
export const ARB_CHRONICLE_FEED_AUTH = '0x39aBD7819E5632Fa06D2ECBba45Dca5c90687EE3'
export const ARB_WUSDM_HOLDER = '0x8c60248a6ca9b6c5620279d40c12eb81e03cd667'
export const ARB_USDM_HOLDER = '0x4bd135524897333bec344e50ddd85126554e58b4'
export const PRICE_TIMEOUT = bn('604800') // 1 week
export const ORACLE_TIMEOUT = bn(86400) // 24 hours in seconds
export const ORACLE_ERROR = fp('0.01') // 1%
export const DEFAULT_THRESHOLD = ORACLE_ERROR.add(fp('0.01')) // 1% + ORACLE_ERROR
export const DELAY_UNTIL_DEFAULT = bn(86400)
export const MAX_TRADE_VOL = bn(1000)

export const FORK_BLOCK_ARBITRUM = 213549300
