import { bn, fp } from '../../../../common/numbers'
import { networkConfig } from '../../../../common/configuration'

// Mainnet Addresses
export const RSR = networkConfig['31337'].tokens.RSR as string
export const ETH_USD_PRICE_FEED = networkConfig['31337'].chainlinkFeeds.ETH as string
export const RETH = networkConfig['31337'].tokens.rETH as string
export const WETH = networkConfig['31337'].tokens.WETH as string
export const RETH_DEPOSIT_POOL = '0x2cac916b2A963Bf162f076C0a8a4a8200BCFBfb4'
export const RETH_WHALE = '0x7C5aaA2a20b01df027aD032f7A768aC015E77b86'
export const RETH_NETWORK_BALANCES = '0x138313f102cE9a0662F826fCA977E3ab4D6e5539'
export const RETH_TRUSTED_NODE = '0x8fB569C14b372430f9aF8B235940187b449d0dec'
export const RETH_STORAGE = '0x1d8f8f00cfa6758d7bE78336684788Fb0ee0Fa46'
export const RETH_ETH_PRICE_FEED = networkConfig['31337'].chainlinkFeeds.rETH as string

export const PRICE_TIMEOUT = bn('604800') // 1 week
export const ORACLE_TIMEOUT = bn(86400) // 24 hours in seconds
export const ORACLE_ERROR = fp('0.005')
export const DEFAULT_THRESHOLD = bn(5).mul(bn(10).pow(16)) // 0.05
export const DELAY_UNTIL_DEFAULT = bn(86400)
export const MAX_TRADE_VOL = bn(1000)

export const FORK_BLOCK = 16804407
