import { IGovParams, IRTokenConfig, networkConfig } from '../../../common/configuration'
import { bn, fp } from '../../../common/numbers'

export const RTOKEN_NAME = 'RTKN'

export type IRToken = { [key: string]: IRTokenConfig & IGovParams }

export const rTokenConfig: { [key: string]: IRToken } = {
  '1': {
    RTKN: {
      name: 'RToken',
      symbol: 'RTKN',
      mandate: 'mandate',
      params: {
        minTradeVolume: fp('1e4'), // $10k
        rTokenMaxTradeVolume: fp('1e6'), // $1M
        dist: {
          rTokenDist: bn(40), // 2/5 RToken
          rsrDist: bn(60), // 3/5 RSR
        },
        rewardRatio: bn('1069671574938'), // approx. half life of 90 days
        unstakingDelay: bn('1209600'), // 2 weeks
        warmupPeriod: bn('60'), // (the delay _after_ SOUND was regained)
        tradingDelay: bn('14400'), // (the delay _after_ default has been confirmed) 4 hours
        batchAuctionLength: bn('900'), // 15 minutes
        dutchAuctionLength: bn('1800'), // 30 minutes
        backingBuffer: fp('0.0001'), // 0.01%
        maxTradeSlippage: fp('0.01'), // 1%
        shortFreeze: bn('259200'), // 3 days
        longFreeze: bn('2592000'), // 30 days
        issuanceThrottle: {
          amtRate: fp('1e6'), // 1M RToken
          pctRate: fp('0.05'), // 5%
        },
        redemptionThrottle: {
          amtRate: fp('1e6'), // 1M RToken
          pctRate: fp('0.05'), // 5%
        },
      },
      votingDelay: bn(7200), // in blocks, 1 day
      votingPeriod: bn(14400), // in blocks, 2 days
      proposalThresholdAsMicroPercent: bn(5e4), // 0.05%
      quorumPercent: bn(10), // 10%
      timelockDelay: bn(2).pow(47), // a hella long time; bricks deployment effectively
    },
  },
  // The 31337 mainnet forking config is realistic for mainnet
  '31337': {
    RTKN: {
      name: 'RToken',
      symbol: 'RTKN',
      mandate: 'mandate',
      params: {
        minTradeVolume: fp('1e4'), // $10k
        rTokenMaxTradeVolume: fp('1e6'), // $1M
        dist: {
          rTokenDist: bn(40), // 2/5 RToken
          rsrDist: bn(60), // 3/5 RSR
        },
        rewardRatio: bn('1069671574938'), // approx. half life of 90 days
        unstakingDelay: bn('1209600'), // 2 weeks
        warmupPeriod: bn('60'), // (the delay _after_ SOUND was regained)
        tradingDelay: bn('14400'), // (the delay _after_ default has been confirmed) 4 hours
        batchAuctionLength: bn('900'), // 15 minutes
        dutchAuctionLength: bn('1800'), // 30 minutes
        backingBuffer: fp('0.0001'), // 0.01%
        maxTradeSlippage: fp('0.01'), // 1%
        shortFreeze: bn('259200'), // 3 days
        longFreeze: bn('2592000'), // 30 days
        issuanceThrottle: {
          amtRate: fp('1e6'), // 1M RToken
          pctRate: fp('0.05'), // 5%
        },
        redemptionThrottle: {
          amtRate: fp('1e6'), // 1M RToken
          pctRate: fp('0.05'), // 5%
        },
      },
      votingDelay: bn(7200), // in blocks, 1 day
      votingPeriod: bn(14400), // in blocks, 2 days
      proposalThresholdAsMicroPercent: bn(5e4), // 0.05%
      quorumPercent: bn(10), // 10%
      timelockDelay: bn(60 * 60 * 24 * 4), // in seconds, 4 days
    },
  },
  '5': {
    RTKN: {
      name: 'RToken',
      symbol: 'RTKN',
      mandate: 'mandate',
      params: {
        minTradeVolume: fp('1e4'), // $10k
        rTokenMaxTradeVolume: fp('1e6'), // $1M
        dist: {
          rTokenDist: bn(40), // 2/5 RToken
          rsrDist: bn(60), // 3/5 RSR
        },
        rewardRatio: bn('1069671574938'), // approx. half life of 90 days
        unstakingDelay: bn('1209600'), // 2 weeks
        warmupPeriod: bn('60'), // (the delay _after_ SOUND was regained)
        tradingDelay: bn('0'), // (the delay _after_ default has been confirmed)
        batchAuctionLength: bn('900'), // 15 minutes
        dutchAuctionLength: bn('1800'), // 30 minutes
        backingBuffer: fp('0.0001'), // 0.01%
        maxTradeSlippage: fp('0.01'), // 1%
        shortFreeze: bn('259200'), // 3 days
        longFreeze: bn('2592000'), // 30 days
        issuanceThrottle: {
          amtRate: fp('1e6'), // 1M RToken
          pctRate: fp('0.05'), // 5%
        },
        redemptionThrottle: {
          amtRate: fp('1e6'), // 1M RToken
          pctRate: fp('0.05'), // 5%
        },
      },
      votingDelay: bn(5), // 5 blocks
      votingPeriod: bn(100), // 100 blocks
      proposalThresholdAsMicroPercent: bn(5e4), // 0.05%
      quorumPercent: bn(10), // 10%
      timelockDelay: bn(1), // 1s
    },
  },
  '84531': {
    RTKN: {
      name: 'RToken',
      symbol: 'RTKN',
      mandate: 'mandate',
      params: {
        minTradeVolume: fp('1e4'), // $10k
        rTokenMaxTradeVolume: fp('1e6'), // $1M
        dist: {
          rTokenDist: bn(40), // 2/5 RToken
          rsrDist: bn(60), // 3/5 RSR
        },
        rewardRatio: bn('1069671574938'), // approx. half life of 90 days
        unstakingDelay: bn('1209600'), // 2 weeks
        warmupPeriod: bn('60'), // (the delay _after_ SOUND was regained)
        tradingDelay: bn('0'), // (the delay _after_ default has been confirmed)
        withdrawalLeak: bn('5e16'),
        batchAuctionLength: bn('900'), // 15 minutes
        dutchAuctionLength: bn('1800'), // 30 minutes
        backingBuffer: fp('0.0001'), // 0.01%
        maxTradeSlippage: fp('0.01'), // 1%
        shortFreeze: bn('259200'), // 3 days
        longFreeze: bn('2592000'), // 30 days
        issuanceThrottle: {
          amtRate: fp('1e6'), // 1M RToken
          pctRate: fp('0.05'), // 5%
        },
        redemptionThrottle: {
          amtRate: fp('1e6'), // 1M RToken
          pctRate: fp('0.05'), // 5%
        },
      },
      votingDelay: bn(5), // 5 blocks
      votingPeriod: bn(100), // 100 blocks
      proposalThresholdAsMicroPercent: bn(5e4), // 0.05%
      quorumPercent: bn(10), // 10%
      timelockDelay: bn(1), // 1s
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
