import { bn, fp } from '../../../../common/numbers'

// Mainnet Addresses
export const PRICE_TIMEOUT = bn(604800) // 1 week
export const ORACLE_TIMEOUT = bn(86400) // 24 hours in seconds
export const ORACLE_ERROR = fp('0.0025')
export const DEFAULT_THRESHOLD = ORACLE_ERROR.add(fp('0.01')) // 1% + ORACLE_ERROR
export const DELAY_UNTIL_DEFAULT = bn(86400)

export const FORK_BLOCK = 19400000

// Morpho AAVE V2 predates the MORPHO token migration and distributes the LEGACY MORPHO token.
// Hardcoded here because networkConfig.tokens.MORPHO now points at the new, transferable token
// (0x58D97B57BB95320F9a05dC918Aef65434969c2B2). The two are convertible 1:1 via the Wrapper at
// 0x9D03bB2092270648d7480049d0E58d2FcF0E5123, but they are distinct ERC20s.
export const LEGACY_MORPHO = '0x9994E35Db50125E0DF82e4c2dde62496CE330999'
