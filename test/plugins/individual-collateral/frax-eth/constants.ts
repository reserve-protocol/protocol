import { bn, fp } from '../../../../common/numbers'
import { networkConfig } from '../../../../common/configuration'

// Mainnet Addresses
export const ETH_USD_PRICE_FEED = networkConfig['31337'].chainlinkFeeds.ETH as string
export const FRX_ETH = networkConfig['31337'].tokens.frxETH as string
export const SFRX_ETH = networkConfig['31337'].tokens.sfrxETH as string
export const WETH = networkConfig['31337'].tokens.WETH as string
export const FRX_ETH_MINTER = '0xbAFA44EFE7901E04E39Dad13167D089C559c1138'
export const CURVE_POOL_EMA_PRICE_ORACLE_ADDRESS = networkConfig['31337']
  .CURVE_POOL_WETH_FRXETH as string

export const PRICE_TIMEOUT = bn('604800') // 1 week
export const ORACLE_TIMEOUT = bn(86400) // 24 hours in seconds
export const ORACLE_ERROR = fp('0.005')
export const DEFAULT_THRESHOLD = bn(5).mul(bn(10).pow(16)) // 0.05
export const DELAY_UNTIL_DEFAULT = bn(86400)
export const MAX_TRADE_VOL = bn(1000)

export const FORK_BLOCK = 18705637
