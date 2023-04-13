import { bn, fp } from '../../../../common/numbers'
import { networkConfig } from '../../../../common/configuration'

// Mainnet Addresses
export const RSR = networkConfig['31337'].tokens.RSR as string
export const DAI_USD_PRICE_FEED = networkConfig['31337'].chainlinkFeeds.DAI as string
export const USDC_USD_PRICE_FEED = networkConfig['31337'].chainlinkFeeds.USDC as string
export const DAI = networkConfig['31337'].tokens.DAI as string
export const USDC = networkConfig['31337'].tokens.USDC as string
export const MCD_VAT = networkConfig['31337'].MCD_VAT as string
export const MCD_JOIN_GUNIV3DAIUSDC1_A = networkConfig['31337'].MCD_JOIN_GUNIV3DAIUSDC1_A as string
export const MCD_JOIN_GUNIV3DAIUSDC2_A = networkConfig['31337'].MCD_JOIN_GUNIV3DAIUSDC2_A as string
export const GUNIV3DAIUSDC1 = networkConfig['31337'].tokens.GUNIV3DAIUSDC1 as string
export const GUNIV3DAIUSDC1_POOL_ILK = '0x47554e49563344414955534443312d4100000000000000000000000000000000'
export const GUNIV3DAIUSDC2 = networkConfig['31337'].tokens.GUNIV3DAIUSDC2 as string
export const GUNIV3DAIUSDC2_POOL_ILK = '0x47554e49563344414955534443322d4100000000000000000000000000000000'
export const ARRAKIS_V1_ROUTER_STAKING = networkConfig['31337'].ARRAKIS_V1_ROUTER_STAKING as string

export const DAI_WHALE = '0x25B313158Ce11080524DcA0fD01141EeD5f94b81'
export const USDC_WHALE = '0xDa9CE944a37d218c3302F6B82a094844C6ECEb17'
export const GUNIV3DAIUSDC1_VAULT_WHALE = '0xbFD445A97e7459b0eBb34cfbd3245750Dba4d7a4'
export const GUNIV3DAIUSDC2_VAULT_WHALE = '0xA7e4dDde3cBcEf122851A7C8F7A55f23c0Daf335'
export const GUNIV3DAIUSDC1_WHALE = '0xb13274203378dCAB4D924Bcae225E78e8Bb1aF20'
export const GUNIV3DAIUSDC2_WHALE = '0x3F62E4C7C23f540445534a9ce62E7b9BE45333AF'

export const PRICE_TIMEOUT = bn('604800') // 1 week
export const ORACLE_TIMEOUT = bn(86400) // 24 hours in seconds
export const ORACLE_ERROR = fp('0.005')
export const DEFAULT_THRESHOLD = bn(5).mul(bn(10).pow(16)) // 0.05
export const DELAY_UNTIL_DEFAULT = bn(86400)
export const MAX_TRADE_VOL = bn(1000)

export const FORK_BLOCK = 15893900

// 1000684224597560041601 at block 15893800
// 1000685620202952463030 at block 15893900
