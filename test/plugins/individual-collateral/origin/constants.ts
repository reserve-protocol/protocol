import { bn, fp } from '../../../../common/numbers'
import { networkConfig } from '../../../../common/configuration'

// Mainnet Addresses
export const WOETH = networkConfig['1'].tokens.wOETH as string
export const WOETH_WHALE = '0xdCa0A2341ed5438E06B9982243808A76B9ADD6d0' // whale
export const FORK_BLOCK = 22164000
export const PRICE_FEEDS = {
  ETH_USD: networkConfig['1'].chainlinkFeeds.ETH, // {USD/ETH}
  OETH_ETH: networkConfig['1'].chainlinkFeeds.OETHETH, // {ETH/OETH}
}

// Base Addresses
export const BASE_WSUPEROETHB = networkConfig['8453'].tokens.wsuperOETHb as string
export const BASE_WSUPEROETHB_WHALE = '0x190e5C6AabB2BeC4eB0B9b2274e9b62cdaEDF356' // Silo
export const FORK_BLOCK_BASE = 21698000
export const BASE_PRICE_FEEDS = {
  ETH_USD: networkConfig['8453'].chainlinkFeeds.ETHUSD, // {USD/ETH}
}
export const BASE_FEEDS_TIMEOUT = {
  ETH_USD: bn(1200),
}
export const BASE_ORACLE_ERROR = fp('0.0015') // only using ETH/USD feed at the moment

// Data
export const PRICE_TIMEOUT = bn('604800') // 1 week
export const ORACLE_TIMEOUT = bn(3600) // 1 hour in seconds
export const OETH_ORACLE_TIMEOUT = bn(86400) // 24 hours in seconds
export const ORACLE_ERROR = fp('0.005') // 0.5%
export const OETH_ORACLE_ERROR = fp('0.01') // 1%
export const DEFAULT_THRESHOLD = bn(5).mul(bn(10).pow(16)) // 0.05
export const DELAY_UNTIL_DEFAULT = bn(86400)
export const MAX_TRADE_VOL = bn(1000)
