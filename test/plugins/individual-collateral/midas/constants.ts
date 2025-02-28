import { bn, fp } from '../../../../common/numbers'

// Common constants for tests
export const PRICE_TIMEOUT = bn(604800) // 1 week
export const CHAINLINK_ORACLE_TIMEOUT = bn(86400) // 24 hours
export const MIDAS_ORACLE_TIMEOUT = bn(2592000) // 30 days
export const ORACLE_TIMEOUT_BUFFER = bn(300) // 5 min
export const ORACLE_ERROR = fp('0.005')
export const DEFAULT_THRESHOLD = fp('0')
export const DELAY_UNTIL_DEFAULT = bn(86400) // 24 hours
export const REVENUE_HIDING = fp('0.0001') // 10 bps
export const FORK_BLOCK = 21360000
