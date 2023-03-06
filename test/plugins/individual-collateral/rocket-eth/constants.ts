import { bn, fp } from '../../../../common/numbers'

// Mainnet Addresses
export const RSR = '0x320623b8e4ff03373931769a31fc52a4e78b5d70'
export const ETH_USD_PRICE_FEED = '0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419'
export const RETH = '0xae78736Cd615f374D3085123A210448E74Fc6393'
export const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'

export const ORACLE_TIMEOUT = bn(86400) // 24 hours in seconds
export const ORACLE_ERROR = fp('0.005')
export const DEFAULT_THRESHOLD = bn(5).mul(bn(10).pow(16)) // 0.05
export const DELAY_UNTIL_DEFAULT = bn(86400)
export const MAX_TRADE_VOL = bn(1000000)

export const FORK_BLOCK = 16771901
