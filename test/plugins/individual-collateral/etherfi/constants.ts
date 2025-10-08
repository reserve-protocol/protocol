import { bn, fp } from '../../../../common/numbers'
import { networkConfig } from '../../../../common/configuration'

// Mainnet Addresses
export const RSR = networkConfig['31337'].tokens.RSR as string
export const ETH_USD_PRICE_FEED = networkConfig['31337'].chainlinkFeeds.ETH as string
export const WEETH = networkConfig['31337'].tokens.weETH as string
export const EETH = networkConfig['31337'].tokens.eETH as string

export const WEETH_ETH_PRICE_FEED = networkConfig['31337'].chainlinkFeeds.weETH as string
export const WETH = networkConfig['31337'].tokens.WETH as string
export const WEETH_WHALE = '0xBdfa7b7893081B35Fb54027489e2Bc7A38275129'
export const LIQUIDITY_POOL = '0x308861A430be4cce5502d0A12724771Fc6DaF216'
export const MEMBERSHIP_MANAGER = '0x3d320286E014C3e1ce99Af6d6B00f0C1D63E3000'

export const PRICE_TIMEOUT = bn('604800') // 1 week
export const ETH_ORACLE_TIMEOUT = bn(3600) // 1 hour in seconds
export const ETH_ORACLE_ERROR = fp('0.005')
export const WEETH_ORACLE_ERROR = fp('0.005') // 0.5%
export const WEETH_ORACLE_TIMEOUT = bn(86400) // 24h

export const DEFAULT_THRESHOLD = fp('0.05') // 5%
export const DELAY_UNTIL_DEFAULT = bn(259200) // 72h
export const MAX_TRADE_VOL = bn(1000)

export const FORK_BLOCK = 19868380
