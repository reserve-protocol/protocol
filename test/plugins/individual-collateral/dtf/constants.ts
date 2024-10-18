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

// to compute: 1 - (1 - annual_fee) ^ (1/31536000)
export const TWO_PERCENT_FEE = bn('640623646') // 2% annually
export const ONE_PERCENT_FEE = bn('318694059') // 1% annually
export const FIFTY_BPS_FEE = bn('158946658') // 0.5% annually
export const TWENTY_FIVE_BPS_FEE = bn('79373738') // 0.25% annually
export const TEN_BPS_FEE = bn('31725657') // 0.1% annually

export const FORK_BLOCK = 20963623
