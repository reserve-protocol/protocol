import { bn, fp } from '../../../../common/numbers'

// Mainnet Addresses
export const ETH_USD_PRICE_FEED = '0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419'
export const ANKRETH = '0xE95A203B1a91a908F9B9CE46459d101078c2c3cb'
export const ANKRETH_WHALE = '0xc8b6eacbd4a4772d77622ca8f3348877cf0beb46'
export const ANKRETH_OWNER = '0x2ffc59d32a524611bb891cab759112a51f9e33c0'

export const ORACLE_TIMEOUT = bn(86400) // 24 hours in seconds
export const ORACLE_ERROR = fp('0.005')
export const DEFAULT_THRESHOLD = bn(5).mul(bn(10).pow(16)) // 0.05
export const DELAY_UNTIL_DEFAULT = bn(86400)
export const MAX_TRADE_VOL = bn(1000)

export const FORK_BLOCK = 14916729
