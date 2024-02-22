import { ethers } from 'hardhat'
import { bn, fp } from '#/common/numbers'
import { PRICE_TIMEOUT } from '#/test/fixtures'
import { makeTests } from './common'
import { networkConfig } from '#/common/configuration'

// Mainnet - USDC
makeTests(
  {
    priceTimeout: PRICE_TIMEOUT,
    chainlinkFeed: networkConfig[1].chainlinkFeeds['USDC']!,
    oracleError: fp('0.0025'),
    erc20: '', // to be set
    maxTradeVolume: fp('1e6'),
    oracleTimeout: bn('86400'),
    targetName: ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.0125'),
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
    oracleError: fp('0.0025'),
    erc20: '', // to be set
    maxTradeVolume: fp('1e6'),
    oracleTimeout: bn('86400'),
    targetName: ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.0125'),
    delayUntilDefault: bn('86400'),
  },
  {
    testName: 'USDC - Base',
    aaveIncentivesController: networkConfig[8453].AAVE_V3_INCENTIVES_CONTROLLER!,
    aavePool: networkConfig[8453].AAVE_V3_POOL!,
    aToken: networkConfig[8453].tokens['aBasUSDC']!,
    whaleTokenHolder: '0x087df3f4a6531ceE97650dDA0Bb8499D968f2249',
    forkBlock: 4446300,
    targetNetwork: 'base',
  }
)

// Mainnet - pyUSD
makeTests(
  {
    priceTimeout: PRICE_TIMEOUT,
    chainlinkFeed: networkConfig[1].chainlinkFeeds['pyUSD']!,
    oracleError: fp('0.003'),
    erc20: '', // to be set
    maxTradeVolume: fp('0.5e6'),
    oracleTimeout: bn('86400'),
    targetName: ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.0125'),
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
