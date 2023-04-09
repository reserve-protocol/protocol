import { bn, fp } from '../../../../common/numbers'
import { networkConfig } from '../../../../common/configuration'

// Mainnet Addresses
export const RSR = networkConfig['31337'].tokens.RSR as string
export const ETH_USD_PRICE_FEED = networkConfig['31337'].chainlinkFeeds.ETH as string
export const WETH = networkConfig['31337'].tokens.WETH as string
export const BENDWETH = networkConfig['31337'].tokens.bendWETH as string
export const BEND = networkConfig['31337'].tokens.BEND as string
export const bendWETH_WHALE = '0x8CffDF5285137678aC461a9623B2b4d4485176a9'
export const ETH_WHALE = '0xbe0eb53f46cd790cd13851d5eff43d12404d33e8'
export const BENDWETH_DATA_PROVIDER = '0x132E3E3eC6652299B235A26D601aa9C68806e3FE'
export const BENDWETH_LEND_POOL_ADDRESS_PROVIDER = '0x24451F47CaF13B24f4b5034e1dF6c0E401ec0e46'
export const BENDDAO_WETH_GATEWAY = '0x3B968D2D299B895A5Fcf3BBa7A64ad0F566e6F88'
export const BENDDAO_INCENTIVES_CONTROLLER = '0x26FC1f11E612366d3367fc0cbFfF9e819da91C8d'

export const PRICE_TIMEOUT = bn('604800') // 1 week
export const ORACLE_TIMEOUT = bn(86400) // 24 hours in seconds
export const ORACLE_ERROR = fp('0.005')
export const DEFAULT_THRESHOLD = bn(5).mul(bn(10).pow(16)) // 0.05
export const DELAY_UNTIL_DEFAULT = bn(86400)
export const MAX_TRADE_VOL = bn(1000)

export const FORK_BLOCK = 16981903
