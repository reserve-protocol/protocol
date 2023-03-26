import { bn, fp } from '../../../../common/numbers'
import { networkConfig } from '../../../../common/configuration'

// Mainnet Addresses

// DAI
export const DAI_USD_FEED = networkConfig['1'].chainlinkFeeds.DAI
export const DAI_ORACLE_TIMEOUT = bn('86400')
export const DAI_ORACLE_ERROR = fp('0.0025')

// USDC
export const USDC_USD_FEED = networkConfig['1'].chainlinkFeeds.USDC
export const USDC_ORACLE_TIMEOUT = bn('86400')
export const USDC_ORACLE_ERROR = fp('0.0025')

// USDT
export const USDT_USD_FEED = networkConfig['1'].chainlinkFeeds.USDT
export const USDT_ORACLE_TIMEOUT = bn('86400')
export const USDT_ORACLE_ERROR = fp('0.0025')

// WBTC
export const WBTC_BTC_FEED = networkConfig['1'].chainlinkFeeds.WBTC
export const BTC_USD_FEED = networkConfig['1'].chainlinkFeeds.BTC
export const WBTC_ORACLE_TIMEOUT = bn('86400')
export const WBTC_BTC_ORACLE_ERROR = fp('0.02')
export const BTC_USD_ORACLE_ERROR = fp('0.005')

// WETH
export const WETH_USD_FEED = networkConfig['1'].chainlinkFeeds.ETH
export const WETH_ORACLE_TIMEOUT = bn('86400')
export const WETH_ORACLE_ERROR = fp('0.005')

// Tokens
export const DAI = networkConfig['1'].tokens.DAI
export const USDC = networkConfig['1'].tokens.USDC
export const USDT = networkConfig['1'].tokens.USDT
export const WETH = networkConfig['1'].tokens.WETH
export const WBTC = networkConfig['1'].tokens.WBTC

export const RSR = networkConfig['1'].tokens.RSR
export const CRV = networkConfig['1'].tokens.CRV
export const CVX = networkConfig['1'].tokens.CVX

// 3pool - USDC, USDT, DAI
export const THREE_POOL = '0xbebc44782c7db0a1a60cb6fe97d0b483032ff1c7'
export const THREE_POOL_TOKEN = '0x6c3F90f043a72FA612cbac8115EE7e52BDe6E490'
export const THREE_POOL_CVX_POOL_ID = 9
export const THREE_POOL_HOLDER = '0xd632f22692fac7611d2aa1c0d552930d43caed3b'

// tricrypto2 - USDT, WBTC, ETH
export const TRI_CRYPTO = '0xd51a44d3fae010294c616388b506acda1bfaae46'
export const TRI_CRYPTO_TOKEN = '0xc4ad29ba4b3c580e6d59105fff484999997675ff'
export const TRI_CRYPTO_CVX_POOL_ID = 38
export const TRI_CRYPTO_HOLDER = '0xDeFd8FdD20e0f34115C7018CCfb655796F6B2168'

// fraxBP
export const FRAX_BP = '0xDcEF968d416a41Cdac0ED8702fAC8128A64241A2'
export const FRAX_BP_TOKEN = '0x3175Df0976dFA876431C2E9eE6Bc45b65d3473CC'

// alUSD + fraxBP -- these metapools combine lpToken + curvePool
export const alUSD_FRAX_BP = '0xB30dA2376F63De30b42dC055C93fa474F31330A5'

// eUSD + fraxBP -- these metapools combine lpToken + curvePool
export const eUSD_FRAX_BP = '0xAEda92e6A3B1028edc139A4ae56Ec881f3064D4F'

export const FIX_ONE = 1n * 10n ** 18n
export const PRICE_TIMEOUT = bn('604800') // 1 week
export const DEFAULT_THRESHOLD = fp('5e-2') // 0.05
export const DELAY_UNTIL_DEFAULT = bn('86400')
export const MAX_TRADE_VOL = bn('1000000')

export const FORK_BLOCK = 15850930

export enum CurvePoolType {
  Plain,
  Lending,
  Metapool,
}
