import { bn, fp } from '../../../../common/numbers'
import { networkConfig } from '../../../../common/configuration'

// Mainnet Addresses
export const USDA = networkConfig['31337'].tokens.USDA as string
export const StUSD = networkConfig['31337'].tokens.stUSD as string
export const USDA_USD_PRICE_FEED = networkConfig['31337'].chainlinkFeeds.USDC as string // we use USDC feed as USDA/USD is not available in chainlink, and USDA/USDC is always 1 through the transmuter
export const USDA_HOLDER = '0xEc0B13b2271E212E1a74D55D51932BD52A002961'
export const stUSD_HOLDER = '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb'
export const PRICE_TIMEOUT = bn('604800') // 1 week
export const ORACLE_TIMEOUT = bn(86400) // 24h
export const ORACLE_ERROR = fp('0.005') // 0.5%
export const DEFAULT_THRESHOLD = fp('0.05') // 5%
export const DELAY_UNTIL_DEFAULT = bn(259200) // 72h
export const MAX_TRADE_VOL = bn(1000)
export const REVENUE_HIDING = fp('1e-6')
export const FORK_BLOCK = 20871587
