import { bn, fp } from '../../../../common/numbers'
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
  case 'arbitrum':
    chainId = '42161'
    break
  default:
    chainId = '1'
    break
}

// Addresses

export const STEAKUSDC = networkConfig[chainId].tokens.steakUSDC!
export const STEAKPYUSD = networkConfig[chainId].tokens.steakPYUSD!
export const BBUSDT = networkConfig[chainId].tokens.bbUSDT!
export const RE7WETH = networkConfig[chainId].tokens.Re7WETH!
export const MEUSD = networkConfig[chainId].tokens.meUSD!
export const ALPHAWETH = networkConfig[chainId].tokens.AlphaWETH!

// USDC
export const USDC_USD_FEED = networkConfig[chainId].chainlinkFeeds.USDC!
export const USDC_ORACLE_TIMEOUT = bn('86400')
export const USDC_ORACLE_ERROR = fp('0.0025')

// PYUSD
export const PYUSD_USD_FEED = networkConfig[chainId].chainlinkFeeds.pyUSD!
export const PYUSD_ORACLE_TIMEOUT = bn('86400')
export const PYUSD_ORACLE_ERROR = fp('0.003')

// USDT
export const USDT_USD_FEED = networkConfig[chainId].chainlinkFeeds.USDT!
export const USDT_ORACLE_TIMEOUT = bn('86400')
export const USDT_ORACLE_ERROR = fp('0.0025')

// ETH
export const ETH_USD_FEED = networkConfig[chainId].chainlinkFeeds.ETH!
export const ETH_ORACLE_TIMEOUT = bn('3600')
export const ETH_ORACLE_ERROR = fp('0.005')

// eUSD
export const eUSD_USD_FEED = networkConfig[chainId].chainlinkFeeds.eUSD!
export const eUSD_ORACLE_TIMEOUT = bn('86400')
export const eUSD_ORACLE_ERROR = fp('0.005')

//  General
export const PRICE_TIMEOUT = bn(604800) // 1 week
export const DELAY_UNTIL_DEFAULT = bn(86400)

const FORK_BLOCKS: { [key: string]: number } = {
  '1': 22974224,
  '8453': 20454200,
  '42161': 193157126, // not used
}

export const FORK_BLOCK = FORK_BLOCKS[chainId]
