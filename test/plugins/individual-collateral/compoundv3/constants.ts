import { bn, fp } from '../../../../common/numbers'

// Mainnet Addresses
export const RSR = '0x320623b8e4ff03373931769a31fc52a4e78b5d70'
export const USDC_USD_PRICE_FEED = '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6'
export const CUSDC_V3 = '0xc3d688B66703497DAA19211EEdff47f25384cdc3'
export const COMP = '0xc00e94Cb662C3520282E6f5717214004A7f26888'
export const REWARDS = '0x1B0e765F6224C21223AeA2af16c1C46E38885a40'
export const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
export const USDC_HOLDER = '0x0a59649758aa4d66e25f08dd01271e891fe52199'
export const COMET_CONFIGURATOR = '0x316f9708bB98af7dA9c68C1C3b5e79039cD336E3'
export const COMET_PROXY_ADMIN = '0x1EC63B5883C3481134FD50D5DAebc83Ecd2E8779'

export const PRICE_TIMEOUT = bn(604800) // 1 week
export const ORACLE_TIMEOUT = bn(86400) // 24 hours in seconds
export const ORACLE_ERROR = fp('0.005')
export const DEFAULT_THRESHOLD = bn(5).mul(bn(10).pow(16)) // 0.05
export const DELAY_UNTIL_DEFAULT = bn(86400)
export const MAX_TRADE_VOL = bn(1000000)
export const USDC_DECIMALS = bn(6)

export const FORK_BLOCK = 15850930
