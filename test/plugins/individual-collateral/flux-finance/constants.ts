import { bn, fp } from '../../../../common/numbers'

// Mainnet Addresses

export const USDC_HOLDER = '0x0A59649758aa4d66E25f08Dd01271e891fe52199'
export const USDT_HOLDER = '0x47ac0Fb4F2D84898e4D9E7b4DaB3C24507a6D503'
export const FRAX_HOLDER = '0xDcEF968d416a41Cdac0ED8702fAC8128A64241A2'
export const DAI_HOLDER = '0xBCb742AAdb031dE5de937108799e89A392f07df1'
// the block number for these addresses is in `test/integration/fork-block-numbers`

export const USDC_ORACLE_ERROR = fp('0.0025') // 0.25%
export const USDT_ORACLE_ERROR = fp('0.0025') // 0.25%
export const DAI_ORACLE_ERROR = fp('0.0025') // 0.25%
export const FRAX_ORACLE_ERROR = fp('0.01') // 1%

export const PRICE_TIMEOUT = bn('604800') // 1 week
export const ORACLE_TIMEOUT = bn(86400) // 24 hours in seconds
export const DEFAULT_THRESHOLD = bn(5).mul(bn(10).pow(16)) // 0.05
export const DELAY_UNTIL_DEFAULT = bn(86400)
export const MAX_TRADE_VOL = bn(1000000)
