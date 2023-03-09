import { bn, fp } from '../../../../common/numbers'

// Mainnet Addresses
export const THREE_POOL = '0xbebc44782c7db0a1a60cb6fe97d0b483032ff1c7'
export const THREE_POOL_TOKEN = '0x6c3F90f043a72FA612cbac8115EE7e52BDe6E490'
export const BBTC_POOL = '0x071c661B4DeefB59E2a3DdB20Db036821eeE8F4b'
export const AAVE_POOL = '0xDeBF20617708857ebe4F679508E7b7863a8A8EeE'
export const DAI_USD_FEED = '0xAed0c38402a5d19df6E4c03F4E2DceD6e29c1ee9'
export const DAI_ORACLE_TIMEOUT = bn('86400')
export const DAI_ORACLE_ERROR = fp('0.0025')
export const USDC_USD_FEED = '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6'
export const USDC_ORACLE_TIMEOUT = bn('86400')
export const USDC_ORACLE_ERROR = fp('0.0025')
export const USDT_USD_FEED = '0x3E7d1eAB13ad0104d2750B8863b489D65364e32D'
export const USDT_ORACLE_TIMEOUT = bn('86400')
export const USDT_ORACLE_ERROR = fp('0.0025')
export const ETH_USD_FEED = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419'
export const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
export const COMP = '0xc00e94Cb662C3520282E6f5717214004A7f26888'
export const RSR = '0x320623b8e4ff03373931769a31fc52a4e78b5d70'
export const DAI = '0x6b175474e89094c44da98b954eedeac495271d0f'
export const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
export const USDT = '0xdac17f958d2ee523a2206206994597c13d831ec7'

export const CVX_POOL_ID = 9
export const CVX_3CRV = '0x30D9410ED1D5DA1F6C8391af5338C93ab8d4035C'
export const CRV = '0xD533a949740bb3306d119CC777fa900bA034cd52'
export const CVX = '0x4e3FBD56CD56c3e72c1403e103b45Db9da5B9D2B'

export const DAI_HOLDER = '0x16b34ce9a6a6f7fc2dd25ba59bf7308e7b38e186'
export const THREE_POOL_HOLDER = '0xd632f22692fac7611d2aa1c0d552930d43caed3b'
export const CVX_3CRV_HOLDER = '0x689440f2ff927e1f24c72f1087e1faf471ece1c8'

export const FIX_ONE = 1n * 10n ** 18n

export const PRICE_TIMEOUT = bn('604800') // 1 week
export const DEFAULT_THRESHOLD = fp('5e-2') // 0.05
export const DELAY_UNTIL_DEFAULT = bn('86400')
export const MAX_TRADE_VOL = bn('1000000')
export const USDC_DECIMALS = bn('6')

export const FORK_BLOCK = 15850930

export enum CurvePoolType {
  Plain,
  Lending,
  Metapool,
}
