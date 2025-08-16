import { bn, fp } from '../../../../common/numbers'
import { networkConfig } from '../../../../common/configuration'

// Mainnet Addresses
export const autoETH = networkConfig['31337'].tokens.autoETH as string
export const autoUSD = networkConfig['31337'].tokens.autoUSD as string

export const PRICE_TIMEOUT = bn('604800') // 1 week
export const ORACLE_TIMEOUT = bn(86400) // 24h
export const ORACLE_ERROR = fp('0.005') // 0.5%
export const DEFAULT_THRESHOLD = fp('0.05') // 5%
export const DELAY_UNTIL_DEFAULT = bn(259200) // 72h
export const MAX_TRADE_VOL = bn(1000)

export const FORK_BLOCK = 23150675
