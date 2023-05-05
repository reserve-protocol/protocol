import { BigNumber, BigNumberish } from 'ethers'
import { ethers } from 'hardhat'
import { IConfig } from '../../common/configuration'
import { bn, fp } from '../../common/numbers'
import { ZERO_ADDRESS } from '../../common/constants'

export enum RebalancingScenarioStatus {
  BEFORE_REBALANCING,
  REBALANCING_ONGOING,
  REBALANCING_DONE,
}

export enum PriceModelKind {
  CONSTANT,
  MANUAL,
  BAND,
  WALK,
}

export interface PriceModel {
  kind: PriceModelKind
  curr: BigNumberish
  low: BigNumberish
  high: BigNumberish
}

export const onePM: PriceModel = {
  kind: PriceModelKind.CONSTANT,
  curr: fp(1),
  low: fp(1),
  high: fp(1),
}

export function aroundPM(value: BigNumberish, spread: BigNumberish): PriceModel {
  // e.g, aroundPM(fp(100), fp(0.05)) should give a BAND PriceModel [fp(95), fp(105)].

  const v = BigNumber.from(value)
  // low = value * (1 - spread)
  const low: BigNumber = v.mul(fp(1).sub(spread)).div(fp(1))

  // high = value * (1 + spread)
  const high: BigNumber = v.mul(fp(1).add(spread)).div(fp(1))

  return {
    kind: PriceModelKind.BAND,
    curr: BigNumber.from(value),
    low: low,
    high: high,
  }
}

export const CONFIG: IConfig = {
  dist: { rTokenDist: bn(40), rsrDist: bn(60) },
  minTradeVolume: fp(1e4),
  rTokenMaxTradeVolume: fp(1e6),
  rewardPeriod: bn('604800'), // 1 week
  rewardRatio: fp('0.02284'), // approx. half life of 30 pay periods
  unstakingDelay: bn('1209600'), // 2 weeks
  tradingDelay: bn('0'), // (the delay _after_ default has been confirmed)
  batchAuctionLength: bn('900'), // 15 minutes
  backingBuffer: fp('0.0001'), // 0.01%
  maxTradeSlippage: fp('0.01'), // 1%
  shortFreeze: bn(345600),
  longFreeze: bn(1814400),
  issuanceRate: fp('0.00025'), // 0.025% per block or ~0.1% per minute
  scalingRedemptionRate: fp('0.05'),
  redemptionRateFloor: fp('2e7'),
}

export const ZERO_COMPONENTS = {
  rToken: ZERO_ADDRESS,
  stRSR: ZERO_ADDRESS,
  assetRegistry: ZERO_ADDRESS,
  basketHandler: ZERO_ADDRESS,
  backingManager: ZERO_ADDRESS,
  distributor: ZERO_ADDRESS,
  furnace: ZERO_ADDRESS,
  broker: ZERO_ADDRESS,
  rsrTrader: ZERO_ADDRESS,
  rTokenTrader: ZERO_ADDRESS,
}

export function addr(n: BigNumberish): string {
  return ethers.utils.hexZeroPad(BigNumber.from(n).toHexString(), 20)
}
