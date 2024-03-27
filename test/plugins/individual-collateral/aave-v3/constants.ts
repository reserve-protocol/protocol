import { bn, fp } from '#/common/numbers'

export const PYUSD_MAX_TRADE_VOLUME = fp('0.5e6')
export const PYUSD_ORACLE_TIMEOUT = bn('86400')
export const PYUSD_ORACLE_ERROR = fp('0.003')

export const USDC_MAINNET_MAX_TRADE_VOLUME = fp('1e6')
export const USDC_MAINNET_ORACLE_TIMEOUT = bn('86400')
export const USDC_MAINNET_ORACLE_ERROR = fp('0.0025')

export const USDC_BASE_MAX_TRADE_VOLUME = fp('0.5e6')
export const USDC_BASE_ORACLE_TIMEOUT = bn('86400')
export const USDC_BASE_ORACLE_ERROR = fp('0.003')

export const USDC_ARBITRUM_MAX_TRADE_VOLUME = fp('1e6')
export const USDC_ARBITRUM_ORACLE_TIMEOUT = bn('86400')
export const USDC_ARBITRUM_ORACLE_ERROR = fp('0.001')

export const USDT_ARBITRUM_MAX_TRADE_VOLUME = fp('1e6')
export const USDT_ARBITRUM_ORACLE_TIMEOUT = bn('86400')
export const USDT_ARBITRUM_ORACLE_ERROR = fp('0.001')
