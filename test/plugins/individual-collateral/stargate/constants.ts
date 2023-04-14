import { bn, fp } from '#/common/numbers'

export const STARGATE = '0xAf5191B0De278C7286d6C7CC6ab6BB8A73bA2Cd6'
export const STAKING_CONTRACT = '0xB0D502E938ed5f4df2E681fE6E419ff29631d62b'
export const SUSDC = '0xdf0770dF86a8034b3EFEf0A1Bb3c889B8332FF56'
export const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
export const USDC_HOLDER = '0x0a59649758aa4d66e25f08dd01271e891fe52199'
export const USDC_USD_PRICE_FEED = '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6'
export const ETH_USD_PRICE_FEED = '0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419'
export const SUSDC_POOL_ID = bn('1')
export const WSUSDC_NAME = 'Wrapped S*USDC'
export const WSUSDC_SYMBOL = 'wS*USDC'

export const ORACLE_TIMEOUT = bn(86400) // 24 hours in seconds
export const ORACLE_ERROR = fp('0.005')
export const DEFAULT_THRESHOLD = bn(5).mul(bn(10).pow(16)) // 0.05
export const DELAY_UNTIL_DEFAULT = bn(86400)
export const MAX_TRADE_VOL = bn(1000000)
export const USDC_DECIMALS = bn(6)
