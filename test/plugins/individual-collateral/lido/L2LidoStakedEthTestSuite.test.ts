import collateralTests from '../collateralTests'
import { CollateralFixtureContext, CollateralOpts, MintCollateralFunc } from '../pluginTestTypes'
import { mintWSTETH } from './helpers'
import { expect } from 'chai'
import { ethers } from 'hardhat'
import { ContractFactory, BigNumber, BigNumberish } from 'ethers'
import {
  ERC20Mock,
  MockV3Aggregator,
  MockV3Aggregator__factory,
  TestICollateral,
  IWSTETH,
} from '../../../../typechain'
import { pushOracleForward } from '../../../utils/oracles'
import { bn, fp } from '../../../../common/numbers'
import { ZERO_ADDRESS } from '../../../../common/constants'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  PRICE_TIMEOUT,
  MAX_TRADE_VOL,
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
  FORK_BLOCK_BASE,
  BASE_PRICE_FEEDS,
  BASE_FEEDS_TIMEOUT,
  BASE_ORACLE_ERROR,
  BASE_WSTETH,
  BASE_WSTETH_WHALE,
} from './constants'
import { getResetFork } from '../helpers'

/*
  Define interfaces
*/
interface WSTETHCollateralFixtureContext extends CollateralFixtureContext {
  wsteth: IWSTETH
  targetPerRefChainlinkFeed: MockV3Aggregator
  uoaPerTargetChainlinkFeed: MockV3Aggregator
  refPerTokenChainlinkFeed: MockV3Aggregator
}

/*
  Define deployment functions
*/

interface WSTETHCollateralOpts extends CollateralOpts {
  targetPerRefChainlinkFeed?: string
  targetPerRefChainlinkTimeout?: BigNumberish
  uoaPerTargetChainlinkFeed?: string
  uoaPerTargetChainlinkTimeout?: BigNumberish
  refPerTokenChainlinkFeed?: string
  refPerTokenChainlinkTimeout?: BigNumberish
}

export const defaultWSTETHCollateralOpts: WSTETHCollateralOpts = {
  erc20: BASE_WSTETH,
  targetName: ethers.utils.formatBytes32String('ETH'),
  rewardERC20: ZERO_ADDRESS,
  priceTimeout: PRICE_TIMEOUT,
  chainlinkFeed: BASE_PRICE_FEEDS.stETH_ETH, // ignored
  oracleTimeout: BASE_FEEDS_TIMEOUT.stETH_ETH, // ignored
  oracleError: BASE_ORACLE_ERROR,
  maxTradeVolume: MAX_TRADE_VOL,
  defaultThreshold: DEFAULT_THRESHOLD,
  delayUntilDefault: DELAY_UNTIL_DEFAULT,
  targetPerRefChainlinkFeed: BASE_PRICE_FEEDS.stETH_ETH,
  targetPerRefChainlinkTimeout: BASE_FEEDS_TIMEOUT.stETH_ETH,
  uoaPerTargetChainlinkFeed: BASE_PRICE_FEEDS.ETH_USD,
  uoaPerTargetChainlinkTimeout: BASE_FEEDS_TIMEOUT.ETH_USD,
  refPerTokenChainlinkFeed: BASE_PRICE_FEEDS.wstETH_stETH,
  refPerTokenChainlinkTimeout: BASE_FEEDS_TIMEOUT.wstETH_stETH,
  revenueHiding: fp('1e-4'),
}

export const deployCollateral = async (
  opts: WSTETHCollateralOpts = {}
): Promise<TestICollateral> => {
  opts = { ...defaultWSTETHCollateralOpts, ...opts }

  const WStEthCollateralFactory: ContractFactory = await ethers.getContractFactory(
    'L2LidoStakedEthCollateral'
  )

  const collateral = <TestICollateral>await WStEthCollateralFactory.deploy(
    {
      erc20: opts.erc20,
      targetName: opts.targetName,
      rewardERC20: opts.rewardERC20,
      priceTimeout: opts.priceTimeout,
      chainlinkFeed: opts.chainlinkFeed,
      oracleError: opts.oracleError,
      oracleTimeout: opts.oracleTimeout,
      maxTradeVolume: opts.maxTradeVolume,
      defaultThreshold: opts.defaultThreshold,
      delayUntilDefault: opts.delayUntilDefault,
    },
    opts.revenueHiding,
    opts.targetPerRefChainlinkFeed,
    opts.targetPerRefChainlinkTimeout,
    opts.chainlinkFeed ?? opts.uoaPerTargetChainlinkFeed,
    opts.uoaPerTargetChainlinkTimeout,
    opts.refPerTokenChainlinkFeed,
    opts.refPerTokenChainlinkTimeout,
    { gasLimit: 2000000000 }
  )

  // Push forward chainlink feed
  await pushOracleForward(opts.targetPerRefChainlinkFeed!)
  await pushOracleForward(opts.uoaPerTargetChainlinkFeed!)
  await pushOracleForward(opts.refPerTokenChainlinkFeed!)

  await collateral.deployed()
  // sometimes we are trying to test a negative test case and we want this to fail silently
  // fortunately this syntax fails silently because our tools are terrible
  await expect(collateral.refresh())

  return collateral
}

const defaultAnswers = {
  targetPerRefChainlinkFeed: bn('1e18'),
  uoaPerTargetChainlinkFeed: bn('2000e8'),
  refPerTokenChainlinkFeed: bn('1.1e18'),
}

type Fixture<T> = () => Promise<T>

const makeCollateralFixtureContext = (
  alice: SignerWithAddress,
  opts: CollateralOpts = {}
): Fixture<WSTETHCollateralFixtureContext> => {
  const collateralOpts = { ...defaultWSTETHCollateralOpts, ...opts }

  const makeCollateralFixtureContext = async () => {
    const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
      await ethers.getContractFactory('MockV3Aggregator')
    )

    const targetPerRefChainlinkFeed = await MockV3AggregatorFactory.deploy(
      18,
      defaultAnswers.targetPerRefChainlinkFeed
    )
    const uoaPerTargetChainlinkFeed = opts.chainlinkFeed
      ? MockV3AggregatorFactory.attach(opts.chainlinkFeed)
      : await MockV3AggregatorFactory.deploy(8, defaultAnswers.uoaPerTargetChainlinkFeed)
    const refPerTokenChainlinkFeed = await MockV3AggregatorFactory.deploy(
      18,
      defaultAnswers.refPerTokenChainlinkFeed
    )

    collateralOpts.chainlinkFeed = uoaPerTargetChainlinkFeed.address
    collateralOpts.targetPerRefChainlinkFeed = targetPerRefChainlinkFeed.address
    collateralOpts.uoaPerTargetChainlinkFeed = uoaPerTargetChainlinkFeed.address
    collateralOpts.refPerTokenChainlinkFeed = refPerTokenChainlinkFeed.address

    const wsteth = (await ethers.getContractAt('IWSTETH', BASE_WSTETH)) as IWSTETH
    const rewardToken = (await ethers.getContractAt('ERC20Mock', ZERO_ADDRESS)) as ERC20Mock
    const collateral = await deployCollateral(collateralOpts)

    return {
      alice,
      collateral,
      wsteth,
      tok: wsteth,
      rewardToken,
      chainlinkFeed: uoaPerTargetChainlinkFeed,
      targetPerRefChainlinkFeed,
      uoaPerTargetChainlinkFeed,
      refPerTokenChainlinkFeed,
    }
  }

  return makeCollateralFixtureContext
}

/*
  Define helper functions
*/

const mintCollateralTo: MintCollateralFunc<WSTETHCollateralFixtureContext> = async (
  ctx: WSTETHCollateralFixtureContext,
  amount: BigNumberish,
  user: SignerWithAddress,
  recipient: string
) => {
  await mintWSTETH(ctx.wsteth, user, amount, recipient, BASE_WSTETH_WHALE)
}

const reduceTargetPerRef = async (
  ctx: WSTETHCollateralFixtureContext,
  pctDecrease: BigNumberish
) => {
  const lastRound = await ctx.targetPerRefChainlinkFeed.latestRoundData()
  const nextAnswer = lastRound.answer.sub(lastRound.answer.mul(pctDecrease).div(100))
  await ctx.targetPerRefChainlinkFeed.updateAnswer(nextAnswer)
}

const increaseTargetPerRef = async (
  ctx: WSTETHCollateralFixtureContext,
  pctIncrease: BigNumberish
) => {
  const lastRound = await ctx.targetPerRefChainlinkFeed.latestRoundData()
  const nextAnswer = lastRound.answer.add(lastRound.answer.mul(pctIncrease).div(100))
  await ctx.targetPerRefChainlinkFeed.updateAnswer(nextAnswer)
}

const reduceRefPerTok = async (ctx: WSTETHCollateralFixtureContext, pctDecrease: BigNumberish) => {
  const lastRound = await ctx.refPerTokenChainlinkFeed.latestRoundData()
  const nextAnswer = lastRound.answer.sub(lastRound.answer.mul(pctDecrease).div(100))
  await ctx.refPerTokenChainlinkFeed.updateAnswer(nextAnswer)
}

const increaseRefPerTok = async (
  ctx: WSTETHCollateralFixtureContext,
  pctIncrease: BigNumberish
) => {
  const lastRound = await ctx.refPerTokenChainlinkFeed.latestRoundData()
  const nextAnswer = lastRound.answer.add(lastRound.answer.mul(pctIncrease).div(100))
  await ctx.refPerTokenChainlinkFeed.updateAnswer(nextAnswer)
}

const getExpectedPrice = async (ctx: WSTETHCollateralFixtureContext): Promise<BigNumber> => {
  const uoaPerTargetChainlinkFeedAnswer = await ctx.uoaPerTargetChainlinkFeed.latestAnswer()
  const uoaPerTargetChainlinkFeedDecimals = await ctx.uoaPerTargetChainlinkFeed.decimals()

  const targetPerRefChainlinkFeedAnswer = await ctx.targetPerRefChainlinkFeed.latestAnswer()
  const targetPerRefChainlinkFeedDecimals = await ctx.targetPerRefChainlinkFeed.decimals()

  const refPerTok = await ctx.collateral.underlyingRefPerTok()

  const result = uoaPerTargetChainlinkFeedAnswer
    .mul(bn(10).pow(18 - uoaPerTargetChainlinkFeedDecimals))
    .mul(targetPerRefChainlinkFeedAnswer)
    .mul(bn(10).pow(18 - targetPerRefChainlinkFeedDecimals))
    .div(fp('1'))

  return result.mul(refPerTok).div(fp('1'))
}

/*
  Define collateral-specific tests
*/

// eslint-disable-next-line @typescript-eslint/no-empty-function
const collateralSpecificConstructorTests = () => {
  it('does not allow targetPerRef oracle timeout at 0', async () => {
    await expect(deployCollateral({ targetPerRefChainlinkTimeout: 0 })).to.be.revertedWith(
      'targetPerRefTimeout zero'
    )
  })
}

// eslint-disable-next-line @typescript-eslint/no-empty-function
const collateralSpecificStatusTests = () => {}

// eslint-disable-next-line @typescript-eslint/no-empty-function
const beforeEachRewardsTest = async () => {}

/*
  Run the test suite
*/

const opts = {
  deployCollateral,
  collateralSpecificConstructorTests,
  collateralSpecificStatusTests,
  beforeEachRewardsTest,
  makeCollateralFixtureContext,
  mintCollateralTo,
  reduceTargetPerRef,
  increaseTargetPerRef,
  reduceRefPerTok,
  increaseRefPerTok,
  getExpectedPrice,
  itClaimsRewards: it.skip,
  itChecksTargetPerRefDefault: it,
  itChecksTargetPerRefDefaultUp: it,
  itChecksRefPerTokDefault: it,
  itChecksPriceChanges: it,
  itChecksNonZeroDefaultThreshold: it,
  itHasRevenueHiding: it,
  resetFork: getResetFork(FORK_BLOCK_BASE),
  collateralName: 'L2LidoStakedETH',
  chainlinkDefaultAnswer: defaultAnswers.uoaPerTargetChainlinkFeed,
  itIsPricedByPeg: true,
  itHasOracleRefPerTok: true,
  targetNetwork: 'base',
  toleranceDivisor: bn('1e2'),
}

collateralTests(opts)
