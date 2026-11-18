import { utils } from 'ethers'
import { networkConfig } from './configuration'
import { fp } from './numbers'

// Ethereum mainnet only. Shared by deployment, verification, and tests.
export const ousdCollateralConfig = {
  erc20: networkConfig['1'].tokens.wOUSD!,
  targetName: utils.formatBytes32String('USD'),
  priceTimeout: 604800,
  // Required by Asset's constructor, but never read by OUSDCollateral.
  chainlinkFeed: networkConfig['1'].chainlinkFeeds.USDC!,
  oracleTimeout: 1, // Delay before inherited price decay, plus ORACLE_TIMEOUT_BUFFER
  oracleError: fp('0.005'), // Pricing margin only; does not cover an OUSD depeg
  maxTradeVolume: fp('1e6'),
  defaultThreshold: 0, // No depeg detection
  delayUntilDefault: 86400,
}

export const ousdRevenueHiding = fp('1e-4')
