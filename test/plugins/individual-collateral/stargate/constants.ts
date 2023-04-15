import { bn, fp } from '../../../../common/numbers'
import { networkConfig } from '../../../../common/configuration'

// Mainnet Addresses
export const STG_USDC_POOL = "0xdf0770dF86a8034b3EFEf0A1Bb3c889B8332FF56";
export const STG_USDT_POOL = "0x38EA452219524Bb87e18dE1C24D3bB59510BD783";
export const STG_WETH_POOL = "0x101816545F6bd2b1076434B54383a1E633390A2E";
export const SGETH = "0x72E2F4830b9E45d52F80aC08CB2bEC0FeF72eD9c";
export const RSR = networkConfig['31337'].tokens.RSR as string
export const ETH_USD_PRICE_FEED = networkConfig['31337'].chainlinkFeeds.ETH as string
export const USDC_USD_PRICE_FEED = networkConfig['31337'].chainlinkFeeds.USDC as string
export const USDT_USD_PRICE_FEED = networkConfig['31337'].chainlinkFeeds.USDT as string
export const WETH = networkConfig['31337'].tokens.WETH as string
export const USDC = networkConfig['31337'].tokens.USDC as string
export const USDT = networkConfig['31337'].tokens.USDT as string
export const PRICE_TIMEOUT = bn('604800') // 1 week
export const ORACLE_TIMEOUT = bn(86400) // 24 hours in seconds
export const ORACLE_ERROR = fp('0.005')
export const DEFAULT_THRESHOLD = bn(5).mul(bn(10).pow(16)) // 0.05
export const DELAY_UNTIL_DEFAULT = bn(86400)
export const MAX_TRADE_VOL = bn(1000)
export const REVENUE_HIDING = fp('0.001')

export const FORK_BLOCK = 179828
