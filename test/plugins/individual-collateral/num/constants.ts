import { bn, fp } from '../../../../common/numbers'
import { networkConfig } from '../../../../common/configuration'

// oracle settings
export const ORACLE_FEED = networkConfig['8453'].chainlinkFeeds.nARS!
export const ORACLE_TIMEOUT = bn('900')
export const ORACLE_ERROR = fp('0.005')

// general
export const PRICE_TIMEOUT = bn(604800) // 1 week
export const DELAY_UNTIL_DEFAULT = bn(86400)

// tests
export const FORK_BLOCK = 20493295
export const NUM_HOLDER = '0xF3F1a405bc844FB3322587a305B1a8b2EC916536'
