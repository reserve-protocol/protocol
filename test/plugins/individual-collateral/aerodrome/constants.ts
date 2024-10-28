import { bn, fp } from '../../../../common/numbers'
import { networkConfig } from '../../../../common/configuration'
import { useEnv } from '#/utils/env'

export const forkNetwork = useEnv('FORK_NETWORK') ?? 'base'

// Base Addresses
export const AERO_USDC_eUSD_GAUGE = '0x793F22aB88dC91793E5Ce6ADbd7E733B0BD4733e'
export const AERO_USDC_eUSD_POOL = '0x7A034374C89C463DD65D8C9BCfe63BcBCED41f4F'
export const AERO_USDC_eUSD_HOLDER = '0xB6C8ea53ABA64a4BdE857D3b25d9DEbD0B149a0a'

export const AERO_WETH_AERO_GAUGE = '0x96a24aB830D4ec8b1F6f04Ceac104F1A3b211a01'
export const AERO_WETH_AERO_POOL = '0x7f670f78B17dEC44d5Ef68a48740b6f8849cc2e6'

export const AERO_MOG_WETH_GAUGE = '0x8FCc385d8d7f3A2e087853a79531630Bf96575e8'
export const AERO_MOG_WETH_POOL = '0x4a311ac4563abc30e71d0631c88a6232c1309ac5'

export const AERODROME_ROUTER = '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43'

// Tokens
export const USDC = networkConfig['8453'].tokens.USDC!
export const eUSD = networkConfig['8453'].tokens.eUSD!
export const AERO = networkConfig['8453'].tokens.AERO!

// USDC
export const USDC_USD_FEED = networkConfig['8453'].chainlinkFeeds.USDC!
export const USDC_ORACLE_TIMEOUT = bn('86400')
export const USDC_ORACLE_ERROR = fp('0.003')
export const USDC_HOLDER = '0x3304E22DDaa22bCdC5fCa2269b418046aE7b566A'

// eUSD
export const eUSD_USD_FEED = networkConfig['8453'].chainlinkFeeds.eUSD!
export const eUSD_ORACLE_TIMEOUT = bn('86400')
export const eUSD_ORACLE_ERROR = fp('0.005')
export const eUSD_HOLDER = '0xb5E331615FdbA7DF49e05CdEACEb14Acdd5091c3'

export const FORK_BLOCK = 19074500

// AERO
export const AERO_ORACLE_ERROR = fp('0.005') // 0.5%
export const AERO_ORACLE_TIMEOUT = bn('86400') // 24hr
export const AERO_USD_FEED = networkConfig['8453'].chainlinkFeeds.AERO!

// ETH
export const ETH_ORACLE_ERROR = fp('0.0015') // 0.15%
export const ETH_ORACLE_TIMEOUT = bn('1200') // 20min
export const ETH_USD_FEED = networkConfig['8453'].chainlinkFeeds.ETHUSD!

// MOG
export const MOG_ORACLE_ERROR = fp('0.005') // 0.5%
export const MOG_ORACLE_TIMEOUT = bn('86400') // 24hr
export const MOG_USD_FEED = networkConfig['8453'].chainlinkFeeds.MOG!

// Common
export const FIX_ONE = 1n * 10n ** 18n
export const ORACLE_ERROR = fp('0.005')
export const PRICE_TIMEOUT = bn('604800') // 1 week
export const DEFAULT_THRESHOLD = fp('0.02') // 2%
export const DELAY_UNTIL_DEFAULT = bn('259200') // 72h CAREFUL THIS IS ONLY FOR RTOKEN POOLS
export const MAX_TRADE_VOL = fp('1e6')

export enum AerodromePoolType {
  Stable,
  Volatile,
}
