import { bn, fp } from '../../../../common/numbers'
import { networkConfig } from '../../../../common/configuration'
import { combinedError } from '../../../../scripts/deployment/utils'

// Mainnet Addresses

// Base Addresses
export const BASE_WSUPEROETHB = networkConfig['8453'].tokens.wsuperOETHb as string
export const BASE_WSUPEROETHB_WHALE = '0x190e5C6AabB2BeC4eB0B9b2274e9b62cdaEDF356' // Silo
export const FORK_BLOCK_BASE = 21698000
export const BASE_PRICE_FEEDS = {
  // traditional finance notation, opposite of our unit system
  wsuperOETHb_ETH: networkConfig['8453'].chainlinkFeeds.wsuperOETHb, // {ETH/wsuperOETHb}
  ETH_USD: networkConfig['8453'].chainlinkFeeds.ETHUSD, // {USD/ETH}
}
export const BASE_FEEDS_TIMEOUT = {
  wsuperOETHb_ETH: bn(86400),
  ETH_USD: bn(1200),
}
export const BASE_ORACLE_ERROR = combinedError(
  fp('0.0015'),
  combinedError(fp('0.005'), fp('0.005'))
)

// Data
export const PRICE_TIMEOUT = bn('604800') // 1 week
export const ORACLE_TIMEOUT = bn(86400) // 24 hours in seconds
export const ORACLE_ERROR = fp('0.005')
export const DEFAULT_THRESHOLD = bn(5).mul(bn(10).pow(16)) // 0.05
export const DELAY_UNTIL_DEFAULT = bn(86400)
export const MAX_TRADE_VOL = bn(1000)
