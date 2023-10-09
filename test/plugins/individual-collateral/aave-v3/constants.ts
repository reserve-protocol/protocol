import { networkConfig } from '../../../../common/configuration'
import { useEnv } from '#/utils/env'

export const forkNetwork = useEnv('FORK_NETWORK') ?? 'mainnet'
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

const aUSDC_NAME = chainId == '8453' ? 'aBasUSDbC' : 'aEthUSDC'

export const AUSDC_V3 = networkConfig[chainId].tokens[aUSDC_NAME]!
export const USDC_USD_PRICE_FEED = networkConfig[chainId].chainlinkFeeds['USDC']! // currently same key for USDC and USDbC

export const USDC_HOLDER =
  chainId == '8453'
    ? '0x4c80E24119CFB836cdF0a6b53dc23F04F7e652CA'
    : '0x0A59649758aa4d66E25f08Dd01271e891fe52199'

export const AAVE_V3_USDC_POOL = networkConfig[chainId].AAVE_V3_POOL!
export const AAVE_V3_INCENTIVES_CONTROLLER = networkConfig[chainId].AAVE_V3_INCENTIVES_CONTROLLER!

export const FORK_BLOCK = chainId == '8453' ? 4446300 : 18000000
