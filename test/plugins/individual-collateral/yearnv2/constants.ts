import { bn, fp } from '../../../../common/numbers'
import { networkConfig } from '../../../../common/configuration'

// Mainnet Addresses
export const USDP = networkConfig['31337'].tokens.USDP as string
export const crvUSD = networkConfig['31337'].tokens.crvUSD as string
export const yvCurveUSDPcrvUSD = networkConfig['31337'].tokens.yvCurveUSDPcrvUSD as string
export const yvCurveUSDCcrvUSD = networkConfig['31337'].tokens.yvCurveUSDCcrvUSD as string
export const USDP_USD_FEED = networkConfig['31337'].chainlinkFeeds.USDP as string
export const CRV_USD_USD_FEED = networkConfig['31337'].chainlinkFeeds.crvUSD as string

export const PRICE_PER_SHARE_HELPER = '0x444443bae5bB8640677A8cdF94CB8879Fec948Ec'

export const YVUSDC_LP_TOKEN = '0x4DEcE678ceceb27446b35C672dC7d61F30bAD69E'
export const YVUSDP_LP_TOKEN = '0xCa978A0528116DDA3cbA9ACD3e68bc6191CA53D0'

export const YVUSDC_HOLDER = '0x96E3e323966713a1f56dbb5D5bFabB28B2e4B428'
export const YVUSDP_HOLDER = '0x40A63aDC56B32fdeF389FcB98571EdDC5e53daeD'

export const USDP_ORACLE_TIMEOUT = bn('3600')
export const USDP_ORACLE_ERROR = fp('0.01')
export const CRV_USD_ORACLE_TIMEOUT = bn('86400')
export const CRV_USD_ORACLE_ERROR = fp('0.005')

export const FORK_BLOCK = 18537600
