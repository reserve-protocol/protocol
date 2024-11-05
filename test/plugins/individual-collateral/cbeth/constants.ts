import { bn, fp } from '../../../../common/numbers'
import { networkConfig } from '../../../../common/configuration'

// Mainnet Addresses
export const ETH_USD_PRICE_FEED = networkConfig['31337'].chainlinkFeeds.ETH as string
export const CBETH_ETH_PRICE_FEED = networkConfig['31337'].chainlinkFeeds.cbETH as string
export const CB_ETH = networkConfig['31337'].tokens.cbETH as string
export const WETH = networkConfig['31337'].tokens.WETH as string
export const CB_ETH_MINTER = '0xd0F73E06E7b88c8e1da291bB744c4eEBAf9Af59f'
export const CB_ETH_ORACLE = '0x9b37180d847B27ADC13C2277299045C1237Ae281'

export const ETH_USD_PRICE_FEED_BASE = networkConfig['8453'].chainlinkFeeds.ETH as string
export const CBETH_ETH_PRICE_FEED_BASE = networkConfig['8453'].chainlinkFeeds.cbETH as string
export const CB_ETH_BASE = networkConfig['8453'].tokens.cbETH as string
export const WETH_BASE = networkConfig['8453'].tokens.WETH as string
export const CBETH_ETH_EXCHANGE_RATE_FEED_BASE = networkConfig['8453'].chainlinkFeeds
  .cbETHETHexr as string
export const CB_ETH_MINTER_BASE = '0x4200000000000000000000000000000000000010'

export const PRICE_TIMEOUT = bn('604800') // 1 week
export const ORACLE_TIMEOUT = bn(86400) // 24 hours in seconds
export const ORACLE_ERROR = fp('0.005')
export const DEFAULT_THRESHOLD = bn(5).mul(bn(10).pow(16)) // 0.05
export const DELAY_UNTIL_DEFAULT = bn(86400)
export const MAX_TRADE_VOL = bn(1000)

export const FORK_BLOCK = 17479312
export const FORK_BLOCK_BASE = 5374534
