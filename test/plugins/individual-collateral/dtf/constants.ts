import { bn, fp } from '../../../../common/numbers'
import { networkConfig } from '../../../../common/configuration'

// Mainnet Addresses
export const XAU_USD_PRICE_FEED = networkConfig['31337'].chainlinkFeeds.XAU as string
export const PAXG = networkConfig['31337'].tokens.PAXG as string

export const PRICE_TIMEOUT = bn('604800') // 1 week
export const ORACLE_TIMEOUT = bn('86400') // 24 hours in seconds
export const ORACLE_ERROR = fp('0.003') // 0.3%
export const DELAY_UNTIL_DEFAULT = bn('86400') // 24h
export const MAX_TRADE_VOL = fp('1e6')

export const FORK_BLOCK = 20963623
