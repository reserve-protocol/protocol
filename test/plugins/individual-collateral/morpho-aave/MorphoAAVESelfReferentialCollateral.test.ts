import { networkConfig } from '#/common/configuration'
import { bn, fp } from '#/common/numbers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { MockV3Aggregator } from '@typechain/MockV3Aggregator'
import { TestICollateral } from '@typechain/TestICollateral'
import {
  ERC20Mock,
  MockV3Aggregator__factory,
  MorphoSelfReferentialCollateral__factory,
} from '@typechain/index'
import { expect } from 'chai'
import { BigNumber, BigNumberish } from 'ethers'
import { parseEther } from 'ethers/lib/utils'
import { ethers } from 'hardhat'
import collateralTests from '../collateralTests'
import { getResetFork } from '../helpers'
import { CollateralOpts } from '../pluginTestTypes'
import { pushOracleForward } from '../../../utils/oracles'
import {
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
}

const deployCollateral = async (opts: MAFiatCollateralOpts = {}): Promise<TestICollateral> => {
  if (opts.defaultThreshold == null && opts.delayUntilDefault === 0) {
    opts.defaultThreshold = fp('0.001')
  }
  opts = { ...defaultCollateralOpts, ...opts }

  const MorphoAAVESelfReferentialCollateral: MorphoSelfReferentialCollateral__factory =
    await ethers.getContractFactory('MorphoSelfReferentialCollateral')
  if (opts.erc20 == null) {
    const MorphoTokenisedDepositMockFactory = await ethers.getContractFactory(
      'MorphoAaveV2TokenisedDepositMock'
    )
    const wrapperMock = await MorphoTokenisedDepositMockFactory.deploy({
      morphoController: networkConfig[1].MORPHO_AAVE_CONTROLLER!,
      morphoLens: networkConfig[1].MORPHO_AAVE_LENS!,
      underlyingERC20: opts.underlyingToken!,
      poolToken: opts.poolToken!,
      rewardToken: networkConfig[1].tokens.MORPHO!,
    })
    opts.erc20 = wrapperMock.address
  }
  const collateral = (await MorphoAAVESelfReferentialCollateral.deploy(
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
    { gasLimit: 2000000000 }
  )) as unknown as TestICollateral
  await collateral.deployed()

  // Push forward chainlink feed
  await pushOracleForward(opts.chainlinkFeed!)

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
      rewardToken: networkConfig[1].tokens.MORPHO!,
    })

    const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
      await ethers.getContractFactory('MockV3Aggregator')
    )

    const chainlinkFeed = <MockV3Aggregator>(
      await MockV3AggregatorFactory.deploy(8, opts.defaultPrice!)
    )
    const collateralOpts = {
      ...opts,
      erc20: wrapperMock.address,
      chainlinkFeed: chainlinkFeed.address,
    }
    const collateral = await deployCollateral(collateralOpts)

    return {
      alice,
      collateral,
      chainlinkFeed,
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

  const lastRound = await ctx.chainlinkFeed.latestRoundData()
  const nextAnswer = lastRound.answer.add(lastRound.answer.mul(percentChange).div(100))
  await ctx.chainlinkFeed.updateAnswer(nextAnswer)
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
  // UoA/tok feed
  const clData = await ctx.chainlinkFeed.latestRoundData()
  const clDecimals = await ctx.chainlinkFeed.decimals()

  const refPerTok = await ctx.collateral.refPerTok()
  const expectedPegPrice = clData.answer.mul(bn(10).pow(18 - clDecimals))
  return expectedPegPrice.mul(refPerTok).div(fp('1'))
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

const defaultCollateralOpts: MAFiatCollateralOpts = {
  targetName: ethers.utils.formatBytes32String('ETH'),
  underlyingToken: networkConfig[1].tokens.stETH!,
  poolToken: networkConfig[1].tokens.astETH!,
  priceTimeout: PRICE_TIMEOUT,
  chainlinkFeed: networkConfig[1].chainlinkFeeds.stETHUSD!,
  oracleTimeout: ORACLE_TIMEOUT,
  oracleError: ORACLE_ERROR,
  maxTradeVolume: parseEther('1000'),
  defaultThreshold: bn(0), // 0.05
  delayUntilDefault: DELAY_UNTIL_DEFAULT,
  revenueHiding: fp('0'),
  defaultPrice: bn('1600e8'),
  defaultRefPerTok: fp('1'),
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
  itChecksTargetPerRefDefaultUp: it.skip,
  itChecksRefPerTokDefault: it,
  itChecksPriceChanges: it,
  itChecksNonZeroDefaultThreshold: it.skip,
  itHasRevenueHiding: it,
  resetFork: getResetFork(FORK_BLOCK),
  collateralName: 'MorphoAAVEV2SelfReferentialCollateral - WETH',
  chainlinkDefaultAnswer: defaultCollateralOpts.defaultPrice!,
}

collateralTests(opts)
