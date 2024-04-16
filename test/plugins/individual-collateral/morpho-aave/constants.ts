import { bn, fp } from '../../../../common/numbers'

// Mainnet Addresses
export const PRICE_TIMEOUT = bn(604800) // 1 week
export const ORACLE_TIMEOUT = bn(86400) // 24 hours in seconds
export const ORACLE_ERROR = fp('0.0025')
export const DEFAULT_THRESHOLD = ORACLE_ERROR.add(fp('0.01')) // 1% + ORACLE_ERROR
export const DELAY_UNTIL_DEFAULT = bn(86400)

export const FORK_BLOCK = 19400000
