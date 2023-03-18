import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { BigNumberish, BigNumber } from 'ethers'
import { MockV3Aggregator, TestICollateral, IERC20Metadata } from '../../../typechain'

type Fixture<T> = () => Promise<T>

export interface CollateralFixtureContext {
  collateral: TestICollateral
  chainlinkFeed: MockV3Aggregator
  tok: IERC20Metadata
  rewardToken: IERC20Metadata
  alice?: SignerWithAddress
}

export interface CollateralOpts {
  erc20?: string
  targetName?: string
  rewardERC20?: string
  priceTimeout?: BigNumberish
  chainlinkFeed?: string
  oracleError?: BigNumberish
  oracleTimeout?: BigNumberish
  maxTradeVolume?: BigNumberish
  defaultThreshold?: BigNumberish
  delayUntilDefault?: BigNumberish
}

export type DeployCollateralFunc = (opts: CollateralOpts) => Promise<TestICollateral>
export type MakeCollateralFixtureFunc<T extends CollateralFixtureContext> = (
  alice: SignerWithAddress,
  opts: CollateralOpts
) => Fixture<T>
export type MintCollateralFunc<T extends CollateralFixtureContext> = (
  ctx: T,
  amount: BigNumberish,
  user: SignerWithAddress,
  recipient: string
) => Promise<void>
export interface CollateralTestSuiteFixtures<T extends CollateralFixtureContext> {
  deployCollateral: DeployCollateralFunc
  collateralSpecificConstructorTests: () => void
  collateralSpecificStatusTests: () => void
  beforeEachRewardsTest: (ctx: T) => void
  makeCollateralFixtureContext: MakeCollateralFixtureFunc<T>
  mintCollateralTo: MintCollateralFunc<T>
  reduceTargetPerRef: (ctx: T, pctDecrease: BigNumberish) => void
  increaseTargetPerRef: (ctx: T, pctIncrease: BigNumberish) => void
  reduceRefPerTok: (ctx: T, pctDecrease: BigNumberish) => void
  increaseRefPerTok: (ctx: T, pctIncrease: BigNumberish) => void
  getExpectedPrice: (ctx: T) => Promise<BigNumber>
  itClaimsRewards: Mocha.TestFunction | Mocha.PendingTestFunction
  itChecksTargetPerRefDefault: Mocha.TestFunction | Mocha.PendingTestFunction
  itChecksRefPerTokDefault: Mocha.TestFunction | Mocha.PendingTestFunction
  itChecksPriceChanges: Mocha.TestFunction | Mocha.PendingTestFunction
  itIsPricedByPeg?: boolean // does the peg price matter for the results of tryPrice()?
  resetFork: () => void
  collateralName: string
  chainlinkDefaultAnswer: BigNumberish
}

export enum CollateralStatus {
  SOUND,
  IFFY,
  DISABLED,
}
