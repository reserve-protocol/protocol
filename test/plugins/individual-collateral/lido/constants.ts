import { bn, fp } from '../../../../common/numbers'
import { networkConfig } from '../../../../common/configuration'

// Mainnet Addresses
export const RSR = networkConfig['31337'].tokens.RSR as string
export const ETH_USD_PRICE_FEED = networkConfig['31337'].chainlinkFeeds.ETH as string
export const STETH_ETH_PRICE_FEED = networkConfig['31337'].chainlinkFeeds.stETH as string
export const STETH = '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84'
export const WSTETH = networkConfig['31337'].tokens.wstETH as string
export const WETH = networkConfig['31337'].tokens.WETH as string
export const WSTETH_WHALE = '0x10CD5fbe1b404B7E19Ef964B63939907bdaf42E2'
export const LIDO_ORACLE = '0x442af784A788A5bd6F42A01Ebe9F287a871243fb'

export const ORACLE_TIMEOUT = bn(86400) // 24 hours in seconds
export const ORACLE_ERROR = fp('0.005')
export const DEFAULT_THRESHOLD = bn(5).mul(bn(10).pow(16)) // 0.05
export const DELAY_UNTIL_DEFAULT = bn(86400)
export const MAX_TRADE_VOL = bn(1000)

export const FORK_BLOCK = 14916729
