import { bn, fp } from '#/common/numbers'
import { networkConfig } from '#/common/configuration'
import { useEnv } from '#/utils/env'

const forkNetwork = useEnv('FORK_NETWORK') ?? 'mainnet'
let chainId

switch (forkNetwork) {
  case 'mainnet':
    chainId = '1'
    break
  case 'base':
    chainId = '8453'
    break
  default:
    chainId = '1'
    break
}

export const USDC_NAME = chainId == '8453' ? 'USDbC' : 'USDC'
const sUSDC_NAME = chainId == '8453' ? 'sUSDbC' : 'sUSDC'

export const STARGATE = networkConfig[chainId].tokens['STG']!
export const STAKING_CONTRACT = networkConfig[chainId].STARGATE_STAKING_CONTRACT!
export const SUSDC = networkConfig[chainId].tokens[sUSDC_NAME]!
export const SUSDT = networkConfig[chainId].tokens['sUSDT']!
export const SETH = networkConfig[chainId].tokens['sETH']!
export const USDC = networkConfig[chainId].tokens[USDC_NAME]!
export const USDT = networkConfig[chainId].tokens['USDT']!
export const USDC_HOLDER =
  chainId == '8453'
    ? '0x4c80e24119cfb836cdf0a6b53dc23f04f7e652ca'
    : '0x0a59649758aa4d66e25f08dd01271e891fe52199'
export const USDC_USD_PRICE_FEED = networkConfig[chainId].chainlinkFeeds['USDC']! // currently same key for USDC and USDbC
export const ETH_USD_PRICE_FEED = networkConfig[chainId].chainlinkFeeds['ETH']!
export const SUSDC_POOL_ID = bn('1')
export const WSUSDC_NAME = 'Wrapped S*USDC'
export const WSUSDC_SYMBOL = 'wS*USDC'
export const STARGATE_ROUTER =
  chainId == '8453'
    ? '0x45f1A95A4D3f3836523F5c83673c797f4d4d263B'
    : '0x8731d54E9D02c286767d56ac03e8037C07e01e98'

export const USDbC = networkConfig[chainId].tokens['USDbC']!
export const SUSDbC = networkConfig[chainId].tokens['sUSDbC']!
export const USDbC_HOLDER = '0x4c80e24119cfb836cdf0a6b53dc23f04f7e652ca'
// export const USDbC_USD_PRICE_FEED = networkConfig[chainId].chainlinkFeeds['USDbC']!

export const ORACLE_TIMEOUT = bn(86400) // 24 hours in seconds
export const ORACLE_ERROR = fp('0.005')
export const DEFAULT_THRESHOLD = bn(5).mul(bn(10).pow(16)) // 0.05
export const DELAY_UNTIL_DEFAULT = bn(86400)
export const MAX_TRADE_VOL = bn(1000000)
export const USDC_DECIMALS = bn(6)

export const FORK_BLOCK = chainId == '8453' ? 5374534 : 17289300
