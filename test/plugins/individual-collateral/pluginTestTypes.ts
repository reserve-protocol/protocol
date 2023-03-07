import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { BigNumberish } from 'ethers'
import { MockV3Aggregator, TestICollateral, IERC20 } from '../../../typechain'

type Fixture<T> = () => Promise<T>

export interface CollateralFixtureContext {
  collateral: TestICollateral
  chainlinkFeed: MockV3Aggregator
  tok: IERC20
  tokDecimals: number // tldr; IERC20 does not include decimals()
  rewardToken: IERC20
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
  reduceRefPerTok: (ctx: T, pctDecrease: BigNumberish | undefined) => void
  increaseRefPerTok: (ctx: T, pctIncrease: BigNumberish | undefined) => void
  itClaimsRewards: Mocha.TestFunction | Mocha.PendingTestFunction
  itChecksTargetPerRefDefault: Mocha.TestFunction | Mocha.PendingTestFunction
  resetFork: () => void
  collateralName: string
  chainlinkDefaultAnswer: BigNumberish
}

export enum CollateralStatus {
  SOUND,
  IFFY,
  DISABLED,
}
