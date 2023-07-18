import { networkConfig } from '#/common/configuration'
import { bn, fp } from '#/common/numbers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { MockV3Aggregator } from '@typechain/MockV3Aggregator'
import { TestICollateral } from '@typechain/TestICollateral'
import {
  ERC20Mock,
  MockV3Aggregator__factory,
  MorphoNonFiatCollateral__factory,
} from '@typechain/index'
import { expect } from 'chai'
import { BigNumber, BigNumberish } from 'ethers'
import { parseEther, parseUnits } from 'ethers/lib/utils'
import { ethers } from 'hardhat'
import collateralTests from '../collateralTests'
import { getResetFork } from '../helpers'
import { CollateralOpts } from '../pluginTestTypes'
import {
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
  FORK_BLOCK,
  ORACLE_ERROR,
  ORACLE_TIMEOUT,
  PRICE_TIMEOUT,
} from './constants'
import { MorphoAaveCollateralFixtureContext, mintCollateralTo } from './mintCollateralTo'

interface MAFiatCollateralOpts extends CollateralOpts {
  underlyingToken?: string
  poolToken?: string
  defaultPrice?: BigNumberish
  defaultRefPerTok?: BigNumberish

  targetPrRefFeed?: string
  refPerTokChainlinkTimeout?: BigNumberish
}

export const deployCollateral = async (
  opts: MAFiatCollateralOpts = {}
): Promise<TestICollateral> => {
  opts = { ...defaultCollateralOpts, ...opts }

  const MorphoAAVECollateralFactory: MorphoNonFiatCollateral__factory =
    await ethers.getContractFactory('MorphoNonFiatCollateral')
  if (opts.erc20 == null) {
    const MorphoTokenisedDepositMockFactory = await ethers.getContractFactory(
      'MorphoAaveV2TokenisedDepositMock'
    )
    const wrapperMock = await MorphoTokenisedDepositMockFactory.deploy({
      morphoController: networkConfig[1].MORPHO_AAVE_CONTROLLER!,
      morphoLens: networkConfig[1].MORPHO_AAVE_LENS!,
      underlyingERC20: opts.underlyingToken!,
      poolToken: opts.poolToken!,
      rewardsDistributor: networkConfig[1].MORPHO_REWARDS_DISTRIBUTOR!,
      rewardToken: networkConfig[1].tokens.MORPHO!,
    })
    opts.erc20 = wrapperMock.address
  }
  const collateral = (await MorphoAAVECollateralFactory.deploy(
    {
      erc20: opts.erc20!,
      targetName: opts.targetName!,
      priceTimeout: opts.priceTimeout!,
      chainlinkFeed: opts.chainlinkFeed!,
      oracleError: opts.oracleError!,
      oracleTimeout: opts.oracleTimeout!,
      maxTradeVolume: opts.maxTradeVolume!,
      defaultThreshold: opts.defaultThreshold!,
      delayUntilDefault: opts.delayUntilDefault!,
    },
    opts.revenueHiding!,
    opts.targetPrRefFeed!,
    opts.refPerTokChainlinkTimeout!,
    { gasLimit: 2000000000 }
  )) as unknown as TestICollateral
  await collateral.deployed()

  await expect(collateral.refresh())

  return collateral
}

type Fixture<T> = () => Promise<T>

const makeCollateralFixtureContext = (
  alice: SignerWithAddress,
  inOpts: MAFiatCollateralOpts = {}
): Fixture<MorphoAaveCollateralFixtureContext> => {
  const makeCollateralFixtureContext = async () => {
    const opts = { ...defaultCollateralOpts, ...inOpts }
    const MorphoTokenisedDepositMockFactory = await ethers.getContractFactory(
      'MorphoAaveV2TokenisedDepositMock'
    )
    const erc20Factory = await ethers.getContractFactory('ERC20Mock')
    const underlyingErc20 = erc20Factory.attach(opts.underlyingToken!)
    const wrapperMock = await MorphoTokenisedDepositMockFactory.deploy({
      morphoController: networkConfig[1].MORPHO_AAVE_CONTROLLER!,
      morphoLens: networkConfig[1].MORPHO_AAVE_LENS!,
      underlyingERC20: opts.underlyingToken!,
      poolToken: opts.poolToken!,
      rewardsDistributor: networkConfig[1].MORPHO_REWARDS_DISTRIBUTOR!,
      rewardToken: networkConfig[1].tokens.MORPHO!,
    })

    const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
      await ethers.getContractFactory('MockV3Aggregator')
    )

    const chainlinkFeed = <MockV3Aggregator>(
      await MockV3AggregatorFactory.deploy(8, opts.defaultPrice!)
    )

    const targetPrRefFeed = <MockV3Aggregator>(
      await MockV3AggregatorFactory.deploy(8, opts.defaultRefPerTok!)
    )

    const collateralOpts = {
      ...opts,
      erc20: wrapperMock.address,
      chainlinkFeed: chainlinkFeed.address,
      targetPrRefFeed: targetPrRefFeed.address,
    }
    const collateral = await deployCollateral(collateralOpts)

    return {
      alice,
      collateral,
      chainlinkFeed,
      targetPrRefFeed,
      tok: wrapperMock as unknown as ERC20Mock,
      morphoWrapper: wrapperMock,
      underlyingErc20: underlyingErc20,
    } as MorphoAaveCollateralFixtureContext
  }

  return makeCollateralFixtureContext
}

/*
  Define helper functions
*/

// eslint-disable-next-line @typescript-eslint/no-empty-function
const reduceTargetPerRef = async () => {}

// eslint-disable-next-line @typescript-eslint/no-empty-function
const increaseTargetPerRef = async () => {}

const changeRefPerTok = async (
  ctx: MorphoAaveCollateralFixtureContext,
  percentChange: BigNumber
) => {
  const rate = await ctx.morphoWrapper.getExchangeRate()
  await ctx.morphoWrapper.setExchangeRate(rate.add(rate.mul(percentChange).div(bn('100'))))

  // {
  //   const lastRound = await ctx.targetPrRefFeed!.latestRoundData()
  //   const nextAnswer = lastRound.answer.add(lastRound.answer.mul(percentChange).div(100))
  //   await ctx.targetPrRefFeed!.updateAnswer(nextAnswer)
  // }

  // {
  //   const lastRound = await ctx.chainlinkFeed.latestRoundData()
  //   const nextAnswer = lastRound.answer.add(lastRound.answer.mul(percentChange).div(100))
  //   await ctx.chainlinkFeed.updateAnswer(nextAnswer)
  // }
}

// prettier-ignore
const reduceRefPerTok = async (
  ctx: MorphoAaveCollateralFixtureContext,
  pctDecrease: BigNumberish
) => {
  await changeRefPerTok(
    ctx,
    bn(pctDecrease).mul(-1)
  )
}
// prettier-ignore
const increaseRefPerTok = async (
  ctx: MorphoAaveCollateralFixtureContext,
  pctIncrease: BigNumberish
) => {
  await changeRefPerTok(
    ctx,
    bn(pctIncrease)
  )
}

const getExpectedPrice = async (ctx: MorphoAaveCollateralFixtureContext): Promise<BigNumber> => {
  const clData = await ctx.chainlinkFeed.latestRoundData()
  const clDecimals = await ctx.chainlinkFeed.decimals()

  const clRptData = await ctx.targetPrRefFeed!.latestRoundData()
  const clRptDecimals = await ctx.targetPrRefFeed!.decimals()

  const expctPrice = clData.answer
    .mul(bn(10).pow(18 - clDecimals))
    .mul(clRptData.answer.mul(bn(10).pow(18 - clRptDecimals)))
    .div(fp('1'))
  return expctPrice
}

/*
  Define collateral-specific tests
*/

// eslint-disable-next-line @typescript-eslint/no-empty-function
const collateralSpecificConstructorTests = () => {}

// eslint-disable-next-line @typescript-eslint/no-empty-function
const collateralSpecificStatusTests = () => {}
// eslint-disable-next-line @typescript-eslint/no-empty-function
const beforeEachRewardsTest = async () => {}

export const defaultCollateralOpts: MAFiatCollateralOpts = {
  targetName: ethers.utils.formatBytes32String('BTC'),
  underlyingToken: networkConfig[1].tokens.WBTC!,
  poolToken: networkConfig[1].tokens.aWBTC!,
  priceTimeout: PRICE_TIMEOUT,
  chainlinkFeed: networkConfig[1].chainlinkFeeds.WBTC!,
  targetPrRefFeed: networkConfig[1].chainlinkFeeds.wBTCBTC!,
  oracleTimeout: ORACLE_TIMEOUT,
  oracleError: ORACLE_ERROR,
  maxTradeVolume: parseEther('100'),
  defaultThreshold: DEFAULT_THRESHOLD,
  delayUntilDefault: DELAY_UNTIL_DEFAULT,
  revenueHiding: fp('0'),
  defaultPrice: parseUnits('30000', 8),
  defaultRefPerTok: parseUnits('1', 8),
  refPerTokChainlinkTimeout: PRICE_TIMEOUT,
}

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
  itChecksTargetPerRefDefault: it.skip,
  itChecksRefPerTokDefault: it,
  itChecksPriceChanges: it,
  itHasRevenueHiding: it,
  resetFork: getResetFork(FORK_BLOCK),
  collateralName: 'MorphoAAVEV2NonFiatCollateral',
  chainlinkDefaultAnswer: defaultCollateralOpts.defaultPrice!,
}

collateralTests(opts)
