import { bn, fp } from '../../../../common/numbers'
import { networkConfig } from '../../../../common/configuration'

// Mainnet Addresses
export const RSR = networkConfig['31337'].tokens.RSR as string
export const DAI_USD_PRICE_FEED = networkConfig['31337'].chainlinkFeeds.DAI as string
export const DAI = networkConfig['31337'].tokens.DAI as string
export const SDAI = networkConfig['31337'].tokens.sDAI as string
export const SDAI_HOLDER = '0xa4108aA1Ec4967F8b52220a4f7e94A8201F2D906'
export const POT = '0x197E90f9FAD81970bA7976f33CbD77088E5D7cf7'

export const PRICE_TIMEOUT = bn('604800') // 1 week
export const ORACLE_TIMEOUT = bn(86400) // 24 hours in seconds
export const ORACLE_ERROR = fp('0.0025') // 0.25%
export const DEFAULT_THRESHOLD = fp('0.05')
export const DELAY_UNTIL_DEFAULT = bn(86400)
export const MAX_TRADE_VOL = bn(1000)

export const FORK_BLOCK = 17439282
