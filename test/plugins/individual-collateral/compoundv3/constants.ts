import { bn, fp } from '../../../../common/numbers'
import { networkConfig } from '../../../../common/configuration'

// Mainnet Addresses
export const RSR = networkConfig['31337'].tokens.RSR as string
export const USDC_USD_PRICE_FEED = networkConfig['31337'].chainlinkFeeds.USDC as string
export const CUSDC_V3 = networkConfig['31337'].tokens.cUSDCv3 as string
export const COMP = networkConfig['31337'].tokens.COMP as string
export const REWARDS = '0x1B0e765F6224C21223AeA2af16c1C46E38885a40'
export const USDC = networkConfig['31337'].tokens.USDC as string
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
