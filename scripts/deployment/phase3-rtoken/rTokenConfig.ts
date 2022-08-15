import { IGovParams, IRTokenConfig, networkConfig } from '../../../common/configuration'
import { bn, fp } from '../../../common/numbers'

type IRToken = { [key: string]: IRTokenConfig & IGovParams }

export const rTokenConfig: { [key: string]: IRToken } = {
  '31337': {
    RTKN: {
      name: 'RToken',
      symbol: 'RTKN',
      mandate: 'mandate',
      params: {
        tradingRange: { min: fp('0.01'), max: fp('1e6') }, // [0.01 tok, 1M tok]
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
        issuanceRate: fp('0.00025'), // 0.025% per block or ~0.1% per minute
        shortFreeze: bn('259200'), // 3 days
        longFreeze: bn('2592000'), // 30 days
      },
      votingDelay: bn(5), // 5 blocks
      votingPeriod: bn(100), // 100 blocks
      proposalThresholdAsMicroPercent: bn(1e6), // 1&
      quorumPercent: bn(4), // 4%
      minDelay: bn(60 * 60 * 24), // 1 day
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
