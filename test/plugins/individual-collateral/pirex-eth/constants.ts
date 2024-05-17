import { bn, fp } from '../../../../common/numbers'
import { networkConfig } from '../../../../common/configuration'

// Mainnet Addresses
export const RSR = networkConfig['31337'].tokens.RSR as string
export const ETH_USD_PRICE_FEED = networkConfig['31337'].chainlinkFeeds.ETH as string
export const APXETH = networkConfig['31337'].tokens.apxETH as string
export const PXETH = networkConfig['31337'].tokens.pxETH as string

export const APXETH_ETH_PRICE_FEED = networkConfig['31337'].chainlinkFeeds.apxETH as string
export const APXETH_OWNER = '0xA52Fd396891E7A74b641a2Cb1A6999Fcf56B077e'
export const PIREX_ETH = '0xD664b74274DfEB538d9baC494F3a4760828B02b0'
export const WETH = networkConfig['31337'].tokens.WETH as string
export const APXETH_WHALE = '0xa5cCBD739e7f5662b95D269ee9A48a37cBFb88Bc'
export const PXETH_WHALE = '0x1cd5b73d12CB23b2835C873E4FaFfE83bBCef208'

export const PRICE_TIMEOUT = bn('604800') // 1 week
export const ORACLE_TIMEOUT = bn(86400) // 24 hours in seconds
export const ORACLE_ERROR = fp('0.005')
export const DEFAULT_THRESHOLD = bn(5).mul(bn(10).pow(16)) // 0.05

export const DELAY_UNTIL_DEFAULT = bn(86400)
export const MAX_TRADE_VOL = bn(1000)

export const FORK_BLOCK = 19868380
