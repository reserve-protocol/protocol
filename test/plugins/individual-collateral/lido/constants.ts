import { bn, fp } from '../../../../common/numbers'

// Mainnet Addresses
export const RSR = '0x320623b8e4ff03373931769a31fc52a4e78b5d70'
export const ETH_USD_PRICE_FEED = '0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419'
export const STETH_ETH_PRICE_FEED = '0x86392dc19c0b719886221c78ab11eb8cf5c52812'
export const STETH = '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84'
export const WSTETH = '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0'
export const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
export const WSTETH_WHALE = '0x10CD5fbe1b404B7E19Ef964B63939907bdaf42E2'
export const LIDO_ORACLE = '0x442af784A788A5bd6F42A01Ebe9F287a871243fb'

export const ORACLE_TIMEOUT = bn(86400) // 24 hours in seconds
export const ORACLE_ERROR = fp('0.005')
export const DEFAULT_THRESHOLD = bn(5).mul(bn(10).pow(16)) // 0.05
export const DELAY_UNTIL_DEFAULT = bn(86400)
export const MAX_TRADE_VOL = bn(1000)

export const FORK_BLOCK = 14916729
