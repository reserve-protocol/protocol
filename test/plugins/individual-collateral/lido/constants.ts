import { bn, fp } from '../../../../common/numbers'
import { networkConfig } from '../../../../common/configuration'
import { combinedError } from '../../../../scripts/deployment/utils'

// Mainnet Addresses
export const STETH_USD_PRICE_FEED = networkConfig['31337'].chainlinkFeeds.stETHUSD as string
export const STETH_ETH_PRICE_FEED = networkConfig['31337'].chainlinkFeeds.stETHETH as string
export const STETH = networkConfig['31337'].tokens.stETH as string
export const WSTETH = networkConfig['31337'].tokens.wstETH as string
export const WETH = networkConfig['31337'].tokens.WETH as string
export const WSTETH_WHALE = '0x10CD5fbe1b404B7E19Ef964B63939907bdaf42E2'
export const LIDO_ORACLE = '0x442af784A788A5bd6F42A01Ebe9F287a871243fb'

export const PRICE_TIMEOUT = bn('604800') // 1 week
export const ORACLE_TIMEOUT = bn(86400) // 24 hours in seconds
export const ORACLE_ERROR = fp('0.005')
export const DEFAULT_THRESHOLD = bn(5).mul(bn(10).pow(16)) // 0.05
export const DELAY_UNTIL_DEFAULT = bn(86400)
export const MAX_TRADE_VOL = bn(1000)
export const FORK_BLOCK = 14916729

// Base Addresses
export const BASE_WSTETH = networkConfig['8453'].tokens.wstETH as string
export const BASE_WSTETH_WHALE = '0xa6385c73961dd9c58db2ef0c4eb98ce4b60651e8'
export const FORK_BLOCK_BASE = 10264000
export const BASE_PRICE_FEEDS = {
  // traditional finance notation, opposite of our unit system
  stETH_ETH: networkConfig['8453'].chainlinkFeeds.stETHETH, // {ETH/stETH}
  ETH_USD: networkConfig['8453'].chainlinkFeeds.ETHUSD, // {USD/ETH}
  wstETH_stETH: networkConfig['8453'].chainlinkFeeds.wstETHstETH, // {stETH/wstETH}
}
export const BASE_FEEDS_TIMEOUT = {
  stETH_ETH: bn(86400),
  ETH_USD: bn(1200), // yep, that's correct
  wstETH_stETH: bn(86400),
}
export const BASE_ORACLE_ERROR = combinedError(
  fp('0.0015'),
  combinedError(fp('0.005'), fp('0.005'))
)
