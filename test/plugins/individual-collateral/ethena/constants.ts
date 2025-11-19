import { bn, fp } from '../../../../common/numbers'
import { networkConfig } from '../../../../common/configuration'

// Mainnet Addresses
export const USDe = networkConfig['31337'].tokens.USDe as string
export const SUSDe = networkConfig['31337'].tokens.sUSDe as string
export const USDe_USD_PRICE_FEED = networkConfig['31337'].chainlinkFeeds.USDe as string
export const USDe_HOLDER = '0x42862F48eAdE25661558AFE0A630b132038553D0'
export const sUSDe_HOLDER = '0x4139cDC6345aFFbaC0692b43bed4D059Df3e6d65'

export const PRICE_TIMEOUT = bn('604800') // 1 week
export const ORACLE_TIMEOUT = bn(82800) // 23 hrs
export const ORACLE_ERROR = fp('0.005') // 0.5%
export const DEFAULT_THRESHOLD = fp('0.05') // 5%
export const DELAY_UNTIL_DEFAULT = bn(259200) // 72h
export const MAX_TRADE_VOL = bn(1000)

export const FORK_BLOCK = 19933080
