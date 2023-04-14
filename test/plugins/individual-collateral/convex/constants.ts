import { bn, fp } from '../../../../common/numbers'
import { networkConfig } from '../../../../common/configuration'

// Mainnet Addresses

// DAI
export const DAI_USD_FEED = networkConfig['1'].chainlinkFeeds.DAI as string
export const DAI_ORACLE_TIMEOUT = bn('86400')
export const DAI_ORACLE_ERROR = fp('0.0025')

// USDC
export const USDC_USD_FEED = networkConfig['1'].chainlinkFeeds.USDC as string
export const USDC_ORACLE_TIMEOUT = bn('86400')
export const USDC_ORACLE_ERROR = fp('0.0025')

// USDT
export const USDT_USD_FEED = networkConfig['1'].chainlinkFeeds.USDT as string
export const USDT_ORACLE_TIMEOUT = bn('86400')
export const USDT_ORACLE_ERROR = fp('0.0025')

// FRAX
export const FRAX_USD_FEED = networkConfig['1'].chainlinkFeeds.FRAX as string
export const FRAX_ORACLE_TIMEOUT = bn('3600')
export const FRAX_ORACLE_ERROR = fp('0.01')

// WBTC
export const WBTC_BTC_FEED = networkConfig['1'].chainlinkFeeds.WBTC as string
export const BTC_USD_FEED = networkConfig['1'].chainlinkFeeds.BTC as string
export const WBTC_ORACLE_TIMEOUT = bn('86400')
export const BTC_ORACLE_TIMEOUT = bn('3600')
export const WBTC_BTC_ORACLE_ERROR = fp('0.02')
export const BTC_USD_ORACLE_ERROR = fp('0.005')

// WETH
export const WETH_USD_FEED = networkConfig['1'].chainlinkFeeds.ETH as string
export const WETH_ORACLE_TIMEOUT = bn('86400')
export const WETH_ORACLE_ERROR = fp('0.005')

// MIM
export const MIM_USD_FEED = networkConfig['1'].chainlinkFeeds.MIM as string
export const MIM_ORACLE_TIMEOUT = bn('86400')
export const MIM_ORACLE_ERROR = fp('0.005') // 0.5%
export const MIM_DEFAULT_THRESHOLD = fp('0.055') // 5.5%

// Tokens
export const DAI = networkConfig['1'].tokens.DAI as string
export const USDC = networkConfig['1'].tokens.USDC as string
export const USDT = networkConfig['1'].tokens.USDT as string
export const FRAX = networkConfig['1'].tokens.FRAX as string
export const MIM = networkConfig['1'].tokens.MIM as string
export const eUSD = networkConfig['1'].tokens.eUSD as string
export const WETH = networkConfig['1'].tokens.WETH as string
export const WBTC = networkConfig['1'].tokens.WBTC as string

export const RSR = networkConfig['1'].tokens.RSR as string
export const CRV = networkConfig['1'].tokens.CRV as string
export const CVX = networkConfig['1'].tokens.CVX as string

// 3pool - USDC, USDT, DAI
export const THREE_POOL = '0xbebc44782c7db0a1a60cb6fe97d0b483032ff1c7'
export const THREE_POOL_TOKEN = '0x6c3F90f043a72FA612cbac8115EE7e52BDe6E490'
export const THREE_POOL_CVX_POOL_ID = 9
export const THREE_POOL_HOLDER = '0xd632f22692fac7611d2aa1c0d552930d43caed3b'
export const THREE_POOL_DEFAULT_THRESHOLD = fp('0.0125') // 1.25%

// tricrypto2 - USDT, WBTC, ETH
export const TRI_CRYPTO = '0xd51a44d3fae010294c616388b506acda1bfaae46'
export const TRI_CRYPTO_TOKEN = '0xc4ad29ba4b3c580e6d59105fff484999997675ff'
export const TRI_CRYPTO_CVX_POOL_ID = 38
export const TRI_CRYPTO_HOLDER = '0xDeFd8FdD20e0f34115C7018CCfb655796F6B2168'

// fraxBP
export const FRAX_BP = '0xDcEF968d416a41Cdac0ED8702fAC8128A64241A2'
export const FRAX_BP_TOKEN = '0x3175Df0976dFA876431C2E9eE6Bc45b65d3473CC'

// eUSD + fraxBP -- this metapool combines lpToken + curvePool
export const eUSD_FRAX_BP = '0xAEda92e6A3B1028edc139A4ae56Ec881f3064D4F'
export const eUSD_FRAX_BP_POOL_ID = 156
export const eUSD_FRAX_HOLDER = '0x8605dc0C339a2e7e85EEA043bD29d42DA2c6D784'

// MIM + 3pool
export const MIM_THREE_POOL = '0x5a6A4D54456819380173272A5E8E9B9904BdF41B'
export const MIM_THREE_POOL_POOL_ID = 40
export const MIM_THREE_POOL_HOLDER = '0x66C90baCE2B68955C875FdA89Ba2c5A94e672440'

// RTokenMetapool-specific
export const RTOKEN_DELAY_UNTIL_DEFAULT = bn('259200') // 72h

// Common
export const FIX_ONE = 1n * 10n ** 18n
export const PRICE_TIMEOUT = bn('604800') // 1 week
export const DEFAULT_THRESHOLD = fp('0.02') // 2%
export const DELAY_UNTIL_DEFAULT = bn('86400')
export const MAX_TRADE_VOL = fp('1e6')

// export const FORK_BLOCK = 15850930 // TODO delete after confirming all cvx tests still passing
export const FORK_BLOCK = 16915576

export enum CurvePoolType {
  Plain,
  Lending,
  Metapool,
}
