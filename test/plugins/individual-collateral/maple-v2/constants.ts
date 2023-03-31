import { bn, fp } from '../../../../common/numbers'
import { networkConfig } from '../../../../common/configuration'

export const config = networkConfig['31337'] // use mainnet fork
export const FORK_BLOCK = 14916729

// Mainnet Addresses

export const MAPLE_USDC_POOL = '0xd3cd37a7299B963bbc69592e5Ba933388f70dc88'
export const MAPLE_WETH_POOL = '0xFfF9A1CAf78b2e5b0A49355a8637EA78b43fB6c3'

export const USDC_HOLDER = '0x0A59649758aa4d66E25f08Dd01271e891fe52199'
export const WETH_HOLDER = '0x08638ef1a205be6762a8b935f5da9b700cf7322c'

export const USDC_TOKEN = config.tokens.USDC as string
export const WETH_TOKEN = config.tokens.WETH as string

export const USDC_PRICE_FEED = config.chainlinkFeeds.USDC as string
export const ETH_PRICE_FEED = config.chainlinkFeeds.ETH as string

// Configuration

export const USDC_PRICE_ERROR = fp('0.0025') // 0.25%
export const WETH_PRICE_ERROR = fp('0.005') // 0.5

export const PRICE_TIMEOUT = bn(604800) // 1 week
export const ORACLE_TIMEOUT = bn(86400) // 24 hours
export const DEFAULT_THRESHOLD = bn(5).mul(bn(10).pow(16)) // 0.05
export const DELAY_UNTIL_DEFAULT = bn(86400)
export const MAX_TRADE_VOL = bn(1000000)
export const REVENUE_HIDING = fp('0.001')
