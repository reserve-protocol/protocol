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
import { parseUnits } from 'ethers/lib/utils'
import { ethers } from 'hardhat'
import collateralTests from '../collateralTests'
import { getResetFork } from '../helpers'
import { CollateralOpts } from '../pluginTestTypes'
import { pushOracleForward } from '../../../utils/oracles'
import {
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
  FORK_BLOCK,
  ORACLE_ERROR,
  ORACLE_TIMEOUT,
  PRICE_TIMEOUT,
} from './constants'
import { MorphoAaveCollateralFixtureContext, mintCollateralTo } from './mintCollateralTo'
const configToUse = networkConfig[31337]

interface MAFiatCollateralOpts extends CollateralOpts {
  underlyingToken?: string
  poolToken?: string
  defaultPrice?: BigNumberish
  defaultRefPerTok?: BigNumberish

  targetPrRefFeed?: string
  refPerTokChainlinkTimeout?: BigNumberish
}
const makeAaveNonFiatCollateralTestSuite = (
  collateralName: string,
  defaultCollateralOpts: MAFiatCollateralOpts
) => {
  const deployCollateral = async (opts: MAFiatCollateralOpts = {}): Promise<TestICollateral> => {
    opts = { ...defaultCollateralOpts, ...opts }

    const MorphoAAVECollateralFactory: MorphoNonFiatCollateral__factory =
      await ethers.getContractFactory('MorphoNonFiatCollateral')
    if (opts.erc20 == null) {
      const MorphoTokenisedDepositMockFactory = await ethers.getContractFactory(
        'MorphoAaveV2TokenisedDepositMock'
      )
      const wrapperMock = await MorphoTokenisedDepositMockFactory.deploy({
        morphoController: configToUse.MORPHO_AAVE_CONTROLLER!,
        morphoLens: configToUse.MORPHO_AAVE_LENS!,
        underlyingERC20: opts.underlyingToken!,
        poolToken: opts.poolToken!,
        rewardToken: configToUse.tokens.MORPHO!,
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

    // Push forward chainlink feed
    await pushOracleForward(opts.chainlinkFeed!)
    await pushOracleForward(opts.targetPrRefFeed!)

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
        morphoController: configToUse.MORPHO_AAVE_CONTROLLER!,
        morphoLens: configToUse.MORPHO_AAVE_LENS!,
        underlyingERC20: opts.underlyingToken!,
        poolToken: opts.poolToken!,
        rewardToken: configToUse.tokens.MORPHO!,
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

  const reduceTargetPerRef = async (
    ctx: MorphoAaveCollateralFixtureContext,
    pctDecrease: BigNumberish
  ) => {
    const lastRound = await ctx.chainlinkFeed!.latestRoundData()
    const nextAnswer = lastRound.answer.sub(lastRound.answer.mul(pctDecrease).div(100))
    await ctx.chainlinkFeed!.updateAnswer(nextAnswer)
  }

  const increaseTargetPerRef = async (
    ctx: MorphoAaveCollateralFixtureContext,
    pctIncrease: BigNumberish
  ) => {
    const lastRound = await ctx.chainlinkFeed!.latestRoundData()
    const nextAnswer = lastRound.answer.add(lastRound.answer.mul(pctIncrease).div(100))
    await ctx.chainlinkFeed!.updateAnswer(nextAnswer)
  }

  const changeRefPerTok = async (
    ctx: MorphoAaveCollateralFixtureContext,
    percentChange: BigNumber
  ) => {
    const rate = await ctx.morphoWrapper.getExchangeRate()
    await ctx.morphoWrapper.setExchangeRate(rate.add(rate.mul(percentChange).div(bn('100'))))
  }

  const reduceRefPerTok = async (
    ctx: MorphoAaveCollateralFixtureContext,
    pctDecrease: BigNumberish
  ) => {
    await changeRefPerTok(ctx, bn(pctDecrease).mul(-1))
  }
  const increaseRefPerTok = async (
    ctx: MorphoAaveCollateralFixtureContext,
    pctIncrease: BigNumberish
  ) => {
    await changeRefPerTok(ctx, bn(pctIncrease))
  }

  const getExpectedPrice = async (ctx: MorphoAaveCollateralFixtureContext): Promise<BigNumber> => {
    const clData = await ctx.chainlinkFeed.latestRoundData()
    const clDecimals = await ctx.chainlinkFeed.decimals()

    const clRptData = await ctx.targetPrRefFeed!.latestRoundData()
    const clRptDecimals = await ctx.targetPrRefFeed!.decimals()

    const expectedPrice = clRptData.answer
      .mul(bn(10).pow(18 - clRptDecimals))
      .mul(clData.answer.mul(bn(10).pow(18 - clDecimals)))
      .div(fp('1'))

    return expectedPrice
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
    itIsPricedByPeg: true,
    resetFork: getResetFork(FORK_BLOCK),
    collateralName,
    chainlinkDefaultAnswer: defaultCollateralOpts.defaultPrice!,
  }

  collateralTests(opts)
}

/*
  Run the test suite
*/
makeAaveNonFiatCollateralTestSuite('MorphoAAVEV2NonFiatCollateral - WBTC', {
  targetName: ethers.utils.formatBytes32String('BTC'),
  underlyingToken: configToUse.tokens.WBTC!,
  poolToken: configToUse.tokens.aWBTC!,
  priceTimeout: PRICE_TIMEOUT,
  chainlinkFeed: configToUse.chainlinkFeeds.WBTC!,
  targetPrRefFeed: configToUse.chainlinkFeeds.BTC!,
  oracleTimeout: ORACLE_TIMEOUT,
  refPerTokChainlinkTimeout: ORACLE_TIMEOUT.div(24),
  oracleError: ORACLE_ERROR,
  maxTradeVolume: fp('1e6'),
  defaultThreshold: DEFAULT_THRESHOLD,
  delayUntilDefault: DELAY_UNTIL_DEFAULT,
  revenueHiding: fp('0'),
  defaultPrice: parseUnits('1', 8),
  defaultRefPerTok: parseUnits('30000', 8),
})

makeAaveNonFiatCollateralTestSuite('MorphoAAVEV2NonFiatCollateral - stETH', {
  targetName: ethers.utils.formatBytes32String('ETH'),
  underlyingToken: configToUse.tokens.stETH!,
  poolToken: configToUse.tokens.astETH!,
  priceTimeout: PRICE_TIMEOUT,
  chainlinkFeed: configToUse.chainlinkFeeds.stETHETH!,
  targetPrRefFeed: configToUse.chainlinkFeeds.ETH!,
  oracleTimeout: ORACLE_TIMEOUT,
  refPerTokChainlinkTimeout: ORACLE_TIMEOUT.div(24),
  oracleError: ORACLE_ERROR,
  maxTradeVolume: fp('1e6'),
  defaultThreshold: DEFAULT_THRESHOLD,
  delayUntilDefault: DELAY_UNTIL_DEFAULT,
  revenueHiding: fp('0'),
  defaultPrice: parseUnits('1', 8),
  defaultRefPerTok: parseUnits('1800', 8),
})
