import { bn, fp } from '../../../../common/numbers'
import { networkConfig } from '../../../../common/configuration'

export const config = networkConfig['31337'] // use mainnet fork
export const FORK_BLOCK = 17052000

// Mainnet Addresses

export const BANCOR_NETWORK = '0xeEF417e1D5CC832e619ae18D2F140De2999dD4fB' // proxy
export const BANCOR_POOL_COLLECTION = '0xB67d563287D12B1F41579cB687b04988Ad564C6C' // NOT a proxy
export const BANCOR_STANDARD_REWARDS = '0xb0B958398ABB0b5DB4ce4d7598Fb868f5A00f372' // proxy

// fiat token
export const USDC_TOKEN = config.tokens.USDC as string
export const USDC_HOLDER = '0x0A59649758aa4d66E25f08Dd01271e891fe52199'
export const BNUSDC_TOKEN = '0xAd7bEc56506D181F994ec380b1BA34fb3FbfBaD3'
export const BNUSDC_HOLDER = '0xa0f75491720835b36edC92D06DDc468D201e9b73'
export const USDC_TO_USD_PRICE_FEED = config.chainlinkFeeds.USDC as string
export const USDC_TO_USD_PRICE_ERROR = fp('0.0025') // 0.25%

// non fiat token
export const BNT_TOKEN = '0x1F573D6Fb3F13d689FF844B4cE37794d79a7FF1C'
export const BNT_HOLDER = '0x649765821D9f64198c905eC0B2B037a4a52Bc373' // bancor master vault
export const BNBNT_TOKEN = '0xAB05Cf7C6c3a288cd36326e4f7b8600e7268E344'
export const BNBNT_HOLDER = '0x02651E355D26f3506C1E644bA393FDD9Ac95EaCa' // actually the bnt pool
export const BNT_TO_ETH_PRICE_FEED = '0xcf61d1841b178fe82c8895fe60c2edda08314416'
export const BNT_TO_ETH_PRICE_ERROR = fp('0.01') // 1%

//self-ref token
export const ETH_TOKEN = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'
export const ETH_HOLDER = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' // wETH contract
export const BNETH_TOKEN = '0x256Ed1d83E3e4EfDda977389A5389C3433137DDA'
export const BNETH_HOLDER = '0xb0B958398ABB0b5DB4ce4d7598Fb868f5A00f372' // actually the std rewards contract
export const ETH_TO_USD_PRICE_FEED = config.chainlinkFeeds.ETH
export const ETH_TO_USD_PRICE_ERROR = fp('0.005') // 0.5%

// Configuration

export const PRICE_TIMEOUT = bn(604800) // 1 week
export const ORACLE_TIMEOUT = bn(86400) // 24 hours
export const DEFAULT_THRESHOLD = bn(5).mul(bn(10).pow(16)) // 0.05
export const DELAY_UNTIL_DEFAULT = bn(86400)
export const MAX_TRADE_VOL = bn(1000000)
export const REVENUE_HIDING = fp('0.001')
