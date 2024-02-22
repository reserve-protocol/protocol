import { ethers } from 'hardhat'
import { bn, fp } from '#/common/numbers'
import { PRICE_TIMEOUT } from '#/test/fixtures'
import { makeTests } from './common'
import { networkConfig } from '#/common/configuration'

/*
 ** Static AToken Factory for Aave V3
 ** Mainnet: 0x411D79b8cC43384FDE66CaBf9b6a17180c842511
 ** --> https://github.com/bgd-labs/aave-address-book/blob/main/src/AaveV3Ethereum.sol#L86
 ** Base: 0x940F9a5d5F9ED264990D0eaee1F3DD60B4Cb9A22
 ** --> https://github.com/bgd-labs/aave-address-book/blob/main/src/AaveV3Base.sol#L78
 */

export const PYUSD_MAX_TRADE_VOLUME = fp('0.5e6')
export const PYUSD_ORACLE_TIMEOUT = bn('86400')
export const PYUSD_ORACLE_ERROR = fp('0.003')

export const USDC_MAINNET_MAX_TRADE_VOLUME = fp('1e6')
export const USDC_MAINNET_ORACLE_TIMEOUT = bn('86400')
export const USDC_MAINNET_ORACLE_ERROR = fp('0.0025')

export const USDC_BASE_MAX_TRADE_VOLUME = fp('0.5e6')
export const USDC_BASE_ORACLE_TIMEOUT = bn('86400')
export const USDC_BASE_ORACLE_ERROR = fp('0.003')

// Mainnet - USDC
makeTests(
  {
    priceTimeout: PRICE_TIMEOUT,
    chainlinkFeed: networkConfig[1].chainlinkFeeds['USDC']!,
    oracleError: USDC_MAINNET_ORACLE_ERROR,
    erc20: '', // to be set
    maxTradeVolume: USDC_MAINNET_MAX_TRADE_VOLUME,
    oracleTimeout: USDC_MAINNET_ORACLE_TIMEOUT,
    targetName: ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.01').add(USDC_MAINNET_ORACLE_TIMEOUT),
    delayUntilDefault: bn('86400'),
  },
  {
    testName: 'USDC - Mainnet',
    aaveIncentivesController: networkConfig[1].AAVE_V3_INCENTIVES_CONTROLLER!,
    aavePool: networkConfig[1].AAVE_V3_POOL!,
    aToken: networkConfig[1].tokens['aEthUSDC']!,
    whaleTokenHolder: '0x0A59649758aa4d66E25f08Dd01271e891fe52199',
    forkBlock: 18000000,
    targetNetwork: 'mainnet',
  }
)

// Base - USDC
makeTests(
  {
    priceTimeout: PRICE_TIMEOUT,
    chainlinkFeed: networkConfig[8453].chainlinkFeeds['USDC']!,
    oracleError: USDC_BASE_ORACLE_ERROR,
    erc20: '', // to be set
    maxTradeVolume: USDC_BASE_MAX_TRADE_VOLUME,
    oracleTimeout: USDC_BASE_ORACLE_TIMEOUT,
    targetName: ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.01').add(USDC_BASE_ORACLE_TIMEOUT),
    delayUntilDefault: bn('86400'),
  },
  {
    testName: 'USDC - Base',
    aaveIncentivesController: networkConfig[8453].AAVE_V3_INCENTIVES_CONTROLLER!,
    aavePool: networkConfig[8453].AAVE_V3_POOL!,
    aToken: networkConfig[8453].tokens['aBasUSDC']!,
    whaleTokenHolder: '0x09ad6981381610a5f58c56219f0fe939043f0a36',
    forkBlock: 4446300,
    targetNetwork: 'base',
  }
)

// Mainnet - pyUSD
makeTests(
  {
    priceTimeout: PRICE_TIMEOUT,
    chainlinkFeed: networkConfig[1].chainlinkFeeds['pyUSD']!,
    oracleError: PYUSD_ORACLE_ERROR,
    erc20: '', // to be set
    maxTradeVolume: PYUSD_MAX_TRADE_VOLUME,
    oracleTimeout: PYUSD_ORACLE_TIMEOUT,
    targetName: ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.01').add(PYUSD_ORACLE_ERROR),
    delayUntilDefault: bn('86400'),
  },
  {
    testName: 'pyUSD - Mainnet',
    aaveIncentivesController: networkConfig[1].AAVE_V3_INCENTIVES_CONTROLLER!,
    aavePool: networkConfig[1].AAVE_V3_POOL!,
    aToken: networkConfig[1].tokens['aEthPyUSD']!,
    whaleTokenHolder: '0xCFFAd3200574698b78f32232aa9D63eABD290703',
    forkBlock: 19270000,
    targetNetwork: 'mainnet',
  }
)
