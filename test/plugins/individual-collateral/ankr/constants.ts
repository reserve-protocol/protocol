import { bn, fp } from '../../../../common/numbers'
import { networkConfig } from '../../../../common/configuration'

// Mainnet Addresses
export const ETH_USD_PRICE_FEED = networkConfig['31337'].chainlinkFeeds.ETH
export const ANKRETH = networkConfig['31337'].tokens.ankrETH as string
export const ANKRETH_WHALE = '0xc8b6eacbd4a4772d77622ca8f3348877cf0beb46'
export const ANKRETH_OWNER = '0x2ffc59d32a524611bb891cab759112a51f9e33c0'

export const PRICE_TIMEOUT = bn('604800') // 1 week
export const ORACLE_TIMEOUT = bn(86400) // 24 hours in seconds
export const ORACLE_ERROR = fp('0.005')
export const DEFAULT_THRESHOLD = bn(5).mul(bn(10).pow(16)) // 0.05
export const DELAY_UNTIL_DEFAULT = bn(86400)
export const MAX_TRADE_VOL = bn(1000)

export const FORK_BLOCK = 14916729
