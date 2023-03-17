import { bn, fp } from '../../../../common/numbers'

// Mainnet Addresses
export const ETH_USD_PRICE_FEED = '0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419'
export const FRX_ETH = '0x5E8422345238F34275888049021821E8E08CAa1f'
export const SFRX_ETH = '0xac3E018457B222d93114458476f3E3416Abbe38F'
export const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
export const FRX_ETH_MINTER = '0xbAFA44EFE7901E04E39Dad13167D089C559c1138'

export const ORACLE_TIMEOUT = bn(86400) // 24 hours in seconds
export const ORACLE_ERROR = fp('0.005')
export const DEFAULT_THRESHOLD = bn(5).mul(bn(10).pow(16)) // 0.05
export const DELAY_UNTIL_DEFAULT = bn(86400)
export const MAX_TRADE_VOL = bn(1000)

export const FORK_BLOCK = 16773193
