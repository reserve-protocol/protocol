import { bn, fp } from '../../../../common/numbers'

// Mainnet Addresses

// DAI
export const DAI_USD_FEED = '0xAed0c38402a5d19df6E4c03F4E2DceD6e29c1ee9'
export const DAI_ORACLE_TIMEOUT = bn('86400')
export const DAI_ORACLE_ERROR = fp('0.0025')

// USDC
export const USDC_USD_FEED = '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6'
export const USDC_ORACLE_TIMEOUT = bn('86400')
export const USDC_ORACLE_ERROR = fp('0.0025')

// USDT
export const USDT_USD_FEED = '0x3E7d1eAB13ad0104d2750B8863b489D65364e32D'
export const USDT_ORACLE_TIMEOUT = bn('86400')
export const USDT_ORACLE_ERROR = fp('0.0025')

// WBTC
export const WBTC_BTC_FEED = '0xfdfd9c85ad200c506cf9e21f1fd8dd01932fbb23'
export const BTC_USD_FEED = '0xf4030086522a5beea4988f8ca5b36dbc97bee88c'
export const WBTC_ORACLE_TIMEOUT = bn('86400')
export const WBTC_BTC_ORACLE_ERROR = fp('0.02')
export const BTC_USD_ORACLE_ERROR = fp('0.005')

// WETH
export const WETH_USD_FEED = '0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419'
export const WETH_ORACLE_TIMEOUT = bn('86400')
export const WETH_ORACLE_ERROR = fp('0.005')

// Tokens
export const DAI = '0x6b175474e89094c44da98b954eedeac495271d0f'
export const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
export const USDT = '0xdac17f958d2ee523a2206206994597c13d831ec7'
export const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
export const WBTC = '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599'

export const RSR = '0x320623b8e4ff03373931769a31fc52a4e78b5d70'
export const CRV = '0xD533a949740bb3306d119CC777fa900bA034cd52'
export const CVX = '0x4e3FBD56CD56c3e72c1403e103b45Db9da5B9D2B'

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
