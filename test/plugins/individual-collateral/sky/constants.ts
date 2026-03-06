import { bn, fp } from '../../../../common/numbers'
import { networkConfig } from '../../../../common/configuration'

// Mainnet Addresses
export const RSR = networkConfig['31337'].tokens.RSR as string

// SUSDS
export const USDS_USD_PRICE_FEED = networkConfig['31337'].chainlinkFeeds.USDS as string
export const USDS = networkConfig['31337'].tokens.USDS as string
export const SUSDS = networkConfig['31337'].tokens.sUSDS as string
export const SUSDS_HOLDER = '0x2d4d2A025b10C09BDbd794B4FCe4F7ea8C7d7bB4'

export const PRICE_TIMEOUT = bn('604800') // 1 week
export const ORACLE_TIMEOUT = bn(82800) // 23 hrs
export const ORACLE_ERROR = fp('0.003') // 0.3%
export const DEFAULT_THRESHOLD = fp('0.05')
export const DELAY_UNTIL_DEFAULT = bn(86400)
export const MAX_TRADE_VOL = bn(1000)

export const FORK_BLOCK = 20890018
