import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { BigNumberish, BigNumber } from 'ethers'
import { MockV3Aggregator, TestICollateral, IERC20Metadata } from '../../../typechain'

type Fixture<T> = () => Promise<T>

// The basic fixture context used in the collateral plugin tests
//  extend this to include other contracts that are deployed or needed as part of the
//  tests that will be run for the plugin (ie. if the collateral uses a wrapper, or extra
//  chainlink feed)
export interface CollateralFixtureContext {
  collateral: TestICollateral
  chainlinkFeed: MockV3Aggregator
  tok: IERC20Metadata
  rewardToken?: IERC20Metadata
  alice?: SignerWithAddress
}

// The basic constructor arguments for a collateral plugin
//  extend this to define the constructor arguments for the collateral plugin being tested
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
  revenueHiding?: BigNumberish
}

// A function to deploy the collateral plugin and return the deployed instance of the contract
export type DeployCollateralFunc = (opts: CollateralOpts) => Promise<TestICollateral>

// A function to deploy and return the plugin-specific test suite context
export type MakeCollateralFixtureFunc<T extends CollateralFixtureContext> = (
  alice: SignerWithAddress,
  opts: CollateralOpts
) => Fixture<T>

// A function to mint a certain amount of collateral to a target address
export type MintCollateralFunc<T extends CollateralFixtureContext> = (
  ctx: T,
  amount: BigNumberish,
  user: SignerWithAddress,
  recipient: string
) => Promise<void>

// The interface that defines the test suite for the collateral plugin
export interface CollateralTestSuiteFixtures<T extends CollateralFixtureContext> {
  // a function to deploy the collateral plugin and return the deployed instance of the contract
  deployCollateral: DeployCollateralFunc

  // a group of tests, specific to the collateral plugin, focused on the plugin's constructor
  collateralSpecificConstructorTests: () => void

  // a group of tests, specific to the collateral plugin, focused on status checks
  collateralSpecificStatusTests: () => void

  // a function to be run in the `beforeEach` block of the rewards tests
  beforeEachRewardsTest: (ctx: T) => void

  // a function to deploy and return the plugin-specific test suite context
  makeCollateralFixtureContext: MakeCollateralFixtureFunc<T>

  // a function to mint a certain amount of collateral to a target address
  mintCollateralTo: MintCollateralFunc<T>

  // a function to reduce the value of `targetPerRef`
  reduceTargetPerRef: (ctx: T, pctDecrease: BigNumberish) => Promise<void> | void

  // a function to increase the value of `targetPerRef`
  increaseTargetPerRef: (ctx: T, pctIncrease: BigNumberish) => Promise<void> | void

  // a function to reduce the value of `refPerTok`
  reduceRefPerTok: (ctx: T, pctDecrease: BigNumberish) => Promise<void> | void

  // a function to increase the value of `refPerTok`
  increaseRefPerTok: (ctx: T, pctIncrease: BigNumberish) => Promise<void> | void

  // a function to calculate the expected price (ignoring oracle error)
  //  that should be returned from `plugin.price()`
  getExpectedPrice: (ctx: T) => Promise<BigNumber>

  // toggle on or off: tests that claim rewards (off if the plugin does not receive rewards)
  itClaimsRewards: Mocha.TestFunction | Mocha.PendingTestFunction

  // toggle on or off: tests that focus on a targetPerRef default
  itChecksTargetPerRefDefault: Mocha.TestFunction | Mocha.PendingTestFunction

  // toggle on or off: tests that focus on a targetPerRef defaulting upwards
  itChecksTargetPerRefDefaultUp: Mocha.TestFunction | Mocha.PendingTestFunction

  // toggle on or off: tests that focus on a refPerTok default
  itChecksRefPerTokDefault: Mocha.TestFunction | Mocha.PendingTestFunction

  // toggle on or off: tests that focus on price changes
  itChecksPriceChanges: Mocha.TestFunction | Mocha.PendingTestFunction

  // toggle on or off: tests that focus on revenue hiding (off if plugin does not hide revenue)
  itHasRevenueHiding: Mocha.TestFunction | Mocha.PendingTestFunction

  // toggle on or off: tests that check that defaultThreshold is not zero
  itChecksNonZeroDefaultThreshold: Mocha.TestFunction | Mocha.PendingTestFunction

  // does the peg price matter for the results of tryPrice()?
  itIsPricedByPeg?: boolean

  // is an oracle that could go stale involved in refPerTok?
  itHasOracleRefPerTok?: boolean

  // a function to reset the fork to a desired block
  resetFork: () => void

  // the name of the collateral plugin being tested
  collateralName: string

  // the default answer that will come from the chainlink feed after deployment
  chainlinkDefaultAnswer: BigNumberish

  // the default tolerance divisor that will be used in expectPrice checks
  toleranceDivisor?: BigNumber

  // the target network to run the collaterals tests on (only runs if forking this network)
  targetNetwork?: string
}

export enum CollateralStatus {
  SOUND,
  IFFY,
  DISABLED,
}
