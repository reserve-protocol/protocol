import { bn, fp } from '#/common/numbers'
import { networkConfig } from '#/common/configuration'

export const STARGATE = networkConfig['1'].tokens['STG']!
export const STAKING_CONTRACT = '0xB0D502E938ed5f4df2E681fE6E419ff29631d62b'
export const SUSDC = networkConfig['1'].tokens['sUSDC']!
export const SUSDT = networkConfig['1'].tokens['sUSDT']!
export const SETH = networkConfig['1'].tokens['sETH']!
export const USDC = networkConfig['1'].tokens['USDC']!
export const USDT = networkConfig['1'].tokens['USDT']!
export const USDC_HOLDER = '0x0a59649758aa4d66e25f08dd01271e891fe52199'
export const USDC_USD_PRICE_FEED = networkConfig['1'].chainlinkFeeds['USDC']!
export const ETH_USD_PRICE_FEED = networkConfig['1'].chainlinkFeeds['ETH']!
export const SUSDC_POOL_ID = bn('1')
export const WSUSDC_NAME = 'Wrapped S*USDC'
export const WSUSDC_SYMBOL = 'wS*USDC'

export const ORACLE_TIMEOUT = bn(86400) // 24 hours in seconds
export const ORACLE_ERROR = fp('0.005')
export const DEFAULT_THRESHOLD = bn(5).mul(bn(10).pow(16)) // 0.05
export const DELAY_UNTIL_DEFAULT = bn(86400)
export const MAX_TRADE_VOL = bn(1000000)
export const USDC_DECIMALS = bn(6)

export const FORK_BLOCK = 18170484
