import { BigNumber, BigNumberish, Signer, Wallet } from 'ethers'
import { ethers } from 'hardhat'
import { IConfig } from '../../common/configuration'
import { bn, fp } from '../../common/numbers'
import { ZERO_ADDRESS } from '../../common/constants'
import { IMainFuzz } from '@typechain/IMainFuzz'
import { NormalOpsScenario } from '@typechain/NormalOpsScenario'
import { RebalancingScenario } from '@typechain/RebalancingScenario'
import { ChaosOpsScenario } from '@typechain/ChaosOpsScenario'
import { MainP1Fuzz } from '@typechain/MainP1Fuzz'

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
  enableIssuancePremium: true
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

export const exa = 10n ** 18n // 1e18 in bigInt. "exa" is the SI prefix for 1000 ** 6
export const ConAt = ethers.getContractAt
export const F = ethers.getContractFactory
export const user = (i: number) => addr((i + 1) * 0x10000)

export const componentsOf = async (main: IMainFuzz) => ({
  rsr: await ConAt('ERC20Fuzz', await main.rsr()),
  rToken: await ConAt('RTokenP1Fuzz', await main.rToken()),
  stRSR: await ConAt('StRSRP1Fuzz', await main.stRSR()),
  assetRegistry: await ConAt('AssetRegistryP1Fuzz', await main.assetRegistry()),
  basketHandler: await ConAt('BasketHandlerP1Fuzz', await main.basketHandler()),
  backingManager: await ConAt('BackingManagerP1Fuzz', await main.backingManager()),
  distributor: await ConAt('DistributorP1Fuzz', await main.distributor()),
  rsrTrader: await ConAt('RevenueTraderP1Fuzz', await main.rsrTrader()),
  rTokenTrader: await ConAt('RevenueTraderP1Fuzz', await main.rTokenTrader()),
  furnace: await ConAt('FurnaceP1Fuzz', await main.furnace()),
  broker: await ConAt('BrokerP1Fuzz', await main.broker()),
})

export type Components = Awaited<ReturnType<typeof componentsOf>>

export type Scenario = NormalOpsScenario | RebalancingScenario | ChaosOpsScenario

export type AbnormalScenario = RebalancingScenario | ChaosOpsScenario

export type FuzzTestFixture = {
  scenario: Scenario
  main: MainP1Fuzz
  comp: Components
  owner: Wallet
  alice: Signer
  bob: Signer
  carol: Signer
  aliceAddr: string
  bobAddr: string
  carolAddr: string
  addrIDs: Map<string, number>
  tokenIDs: Map<string, number>
  warmup: () => void
  collaterals: string[]
  rewards: string[]
  stables: string[]
}

type Fixture<T> = () => Promise<T>

export interface FuzzTestContext<T extends FuzzTestFixture> {
  f: Fixture<T>
  testType: 'Normal' | 'Chaos' | 'Rebalancing'
  scenarioSpecificTests: () => void
}
