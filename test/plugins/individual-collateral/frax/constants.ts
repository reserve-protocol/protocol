import { bn, fp } from '../../../../common/numbers'
import { networkConfig } from '../../../../common/configuration'

// Mainnet Addresses
export const FRAX_USD_PRICE_FEED = networkConfig['31337'].chainlinkFeeds.FRAX as string
export const FRAX = networkConfig['31337'].tokens.FRAX as string
export const SFRAX = networkConfig['31337'].tokens.sFRAX as string
export const SFRAX_HOLDER = '0xC38744840abCe123608B6f79a8Ac7bAE2153194e'

export const PRICE_TIMEOUT = bn('604800') // 1 week
export const ORACLE_TIMEOUT = bn(3600) // 1 hour in seconds
export const ORACLE_ERROR = fp('0.01') // 1%
export const DEFAULT_THRESHOLD = fp('0.02')
export const DELAY_UNTIL_DEFAULT = bn(86400)
export const MAX_TRADE_VOL = bn(1000)

export const FORK_BLOCK = 18522901
