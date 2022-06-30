import {
  IRTokenConfig,
  IRTokenSetup,
  networkConfig,
} from '../../../common/configuration'
import { bn, fp } from '../../../common/numbers'

interface IOwned {
  owner: string
}

interface IGovernanceConfig {
  votingDelay: number
  votingPeriod: number
  proposalThresholdAsMicroPercent: number
  quorumPercent: number
  minDelay: number
}

type IRToken = { [key: string]: IRTokenConfig & IRTokenSetup & IOwned & IGovernanceConfig }

export const rTokenConfig: { [key: string]: IRToken } = {
  '31337': {
    RTKN: {
      name: 'RToken',
      symbol: 'RTKN',
      manifestoURI: 'manifesto',
      params: {
        maxTradeVolume: fp('1e6'), // $1M
        dist: {
          rTokenDist: bn(40), // 2/5 RToken
          rsrDist: bn(60), // 3/5 RSR
        },
        rewardPeriod: bn('604800'), // 1 week
        rewardRatio: fp('0.02284'), // approx. half life of 30 pay periods
        unstakingDelay: bn('1209600'), // 2 weeks
        tradingDelay: bn('0'), // (the delay _after_ default has been confirmed)
        auctionLength: bn('900'), // 15 minutes
        backingBuffer: fp('0.0001'), // 0.01%
        maxTradeSlippage: fp('0.01'), // 1%
        dustAmount: fp('0.01'), // 0.01 UoA (USD)
        issuanceRate: fp('0.00025'), // 0.025% per block or ~0.1% per minute
        oneshotPauseDuration: bn('864000'), // 10 days
        minBidSize: fp('1'), // 1 UoA (USD)
      },
      rewardAssets: ['aave-stkAAVE', 'compound-COMP'],
      primaryBasket: ['aToken-aDAI', 'cToken-cDAI', 'aave-DAI'],
      weights: [fp('0.25'), fp('0.25'), fp('0.5')],
      backups: [
        {
          backupUnit: 'USD',
          diversityFactor: bn(1),
          backupCollateral: ['aave-USDC'],
        },
      ],
      owner: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
      votingDelay: 5, // 5 blocks
      votingPeriod: 100,  // 100 blocks
      proposalThresholdAsMicroPercent: 1e6,  // 1&
      quorumPercent: 4, // 4%
      minDelay: 60 * 60 * 24 // 1 day
    },
  },
}

export const getRTokenConfig = (chainId: string, name: string) => {
  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for network ${chainId}`)
  }

  if (!rTokenConfig[chainId][name]) {
    throw new Error(`Configuration for RToken ${name} not available for network ${chainId}`)
  }
  return rTokenConfig[chainId][name]
}
