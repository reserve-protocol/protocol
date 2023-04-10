import { bn, fp } from '../../../../common/numbers'
import { networkConfig } from '../../../../common/configuration'

// Mainnet Addresses
export const RSR = networkConfig['31337'].tokens.RSR as string
export const ETH_USD_PRICE_FEED = networkConfig['31337'].chainlinkFeeds.ETH as string
export const WETH = networkConfig['31337'].tokens.WETH as string
export const BEND = '0x0d02755a5700414B26FF040e1dE35D337DF56218'
export const BEND_WETH = '0xeD1840223484483C0cb050E6fC344d1eBF0778a9'
export const LENDPOOL = '0x70b97A0da65C15dfb0FFA02aEE6FA36e507C2762'
export const INCENTIVES_CONTROLLER = '0x26FC1f11E612366d3367fc0cbFfF9e819da91C8d'
export const WETH_WHALE = '0xF04a5cC80B1E94C69B48f5ee68a08CD2F09A7c3E'

export const PRICE_TIMEOUT = bn('604800') // 1 week
export const ORACLE_TIMEOUT = bn(86400) // 24 hours in seconds
export const ORACLE_ERROR = fp('0.005')
export const DEFAULT_THRESHOLD = bn(5).mul(bn(10).pow(16)) // 0.05
export const DELAY_UNTIL_DEFAULT = bn(86400)
export const MAX_TRADE_VOL = bn(1000)
export const REVENUE_HIDING = fp('0')

export const FORK_BLOCK = 14916729
