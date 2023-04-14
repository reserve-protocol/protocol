import { bn, fp } from '../../../../common/numbers'
import { networkConfig } from '../../../../common/configuration'

// Mainnet Addresses
export const RSR = networkConfig['31337'].tokens.RSR as string
export const ETH_USD_PRICE_FEED = networkConfig['31337'].chainlinkFeeds.ETH as string
export const DAI_USD_PRICE_FEED = networkConfig['31337'].chainlinkFeeds.DAI as string
export const BWETHDAI = networkConfig['31337'].tokens.BWETHDAI as string
export const GAUGE_FACTORY = '0x4E7bBd911cf1EFa442BC1b2e9Ea01ffE785412EC'
export const BALANCER_MINTER = '0x239e55F427D44C3cc793f49bFB507ebe76638a2b'
export const BAL = '0xba100000625a3754423978a60c9317c58a424e3D'
export const BWETHDAIPOOLID = '0x0b09dea16768f0799065c475be02919503cb2a3500020000000000000000001a'
export const WETH = networkConfig['31337'].tokens.WETH as string
export const DAI = networkConfig['31337'].tokens.DAI as string
// export const RETH_DEPOSIT_POOL = '0x2cac916b2A963Bf162f076C0a8a4a8200BCFBfb4'
export const BWETHDAI_WHALE = '0x6375B32ac8c1fFd97B1EB105659872b2e308502A'
export const WETH_WHALE = '0x2fEb1512183545f48f6b9C5b4EbfCaF49CfCa6F3'
export const DAI_WHALE = '0x604749efB8DC03976D832c8353cB327C5dF09dF6'
export const RETH_TRUSTED_NODE = '0x8fB569C14b372430f9aF8B235940187b449d0dec'
export const RETH_ETH_PRICE_FEED = networkConfig['31337'].chainlinkFeeds.rETH as string

export const PRICE_TIMEOUT = bn('604800') // 1 week
export const ORACLE_TIMEOUT = bn(86400) // 24 hours in seconds
export const ORACLE_ERROR = fp('0.005')
export const DEFAULT_THRESHOLD = bn(5).mul(bn(10).pow(16)) // 0.05
export const DELAY_UNTIL_DEFAULT = bn(86400)
export const MAX_TRADE_VOL = bn(1000)

export const FORK_BLOCK = 17031699
