import collateralTests from '../collateralTests'
import { CollateralFixtureContext, CollateralOpts, MintCollateralFunc } from '../pluginTestTypes'
import { ethers } from 'hardhat'
import { ContractFactory, BigNumberish, BigNumber } from 'ethers'
import {
  IAeroPool,
  MockV3Aggregator,
  MockV3Aggregator__factory,
  InvalidMockV3Aggregator,
  AerodromeGaugeWrapper__factory,
  TestICollateral,
  AerodromeGaugeWrapper,
  ERC20Mock,
} from '../../../../typechain'
import { networkConfig } from '../../../../common/configuration'
import { CollateralStatus, ZERO_ADDRESS } from '#/common/constants'
import { bn, fp } from '../../../../common/numbers'
import { expect } from 'chai'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  AerodromePoolType,
  USDC_USD_FEED,
  USDC_HOLDER,
  USDC_ORACLE_ERROR,
  USDC_ORACLE_TIMEOUT,
  PRICE_TIMEOUT,
  MAX_TRADE_VOL,
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
  AERO_USDC_eUSD_POOL,
  AERO_USDC_eUSD_GAUGE,
  AERO_USDC_eUSD_HOLDER,
  AERO,
  USDC,
  eUSD,
  eUSD_HOLDER,
  eUSD_USD_FEED,
  eUSD_ORACLE_ERROR,
  eUSD_ORACLE_TIMEOUT,
  ORACLE_ERROR,
} from './constants'
import { expectPrice } from '../../../utils/oracles'
import { mintWrappedLpToken, resetFork, getFeeds, pushAllFeedsForward } from './helpers'

/*
  Define interfaces
*/

interface AeroPoolTokenConfig {
  token: string
  feeds: string[]
  oracleTimeouts: BigNumberish[]
  oracleErrors: BigNumberish[]
  holder: string
}

interface AeroStablePoolEnumeration {
  testName: string
  pool: string
  gauge: string
  holder: string
  toleranceDivisor: BigNumber
  amountScaleDivisor: BigNumber
  tokens: AeroPoolTokenConfig[]
  oracleTimeout: BigNumberish
  oracleError: BigNumberish
}

interface AeroStableCollateralOpts extends CollateralOpts {
  pool?: string
  poolType?: AerodromePoolType
  gauge?: string
  feeds?: string[][]
  oracleTimeouts?: BigNumberish[][]
  oracleErrors?: BigNumberish[][]
}

interface AerodromeCollateralFixtureContext extends CollateralFixtureContext {
  feeds?: string[][]
}

// ====

const config = networkConfig['8453'] // use Base fork

// Test all Aerodrome Stable pools
const all: AeroStablePoolEnumeration[] = [
  {
    testName: 'Aerodrome - USDC/eUSD Stable',
    pool: AERO_USDC_eUSD_POOL,
    gauge: AERO_USDC_eUSD_GAUGE,
    holder: AERO_USDC_eUSD_HOLDER,
    tokens: [
      {
        token: USDC,
        feeds: [USDC_USD_FEED],
        oracleTimeouts: [USDC_ORACLE_TIMEOUT],
        oracleErrors: [USDC_ORACLE_ERROR],
        holder: USDC_HOLDER,
      },
      {
        token: eUSD,
        feeds: [eUSD_USD_FEED],
        oracleTimeouts: [eUSD_ORACLE_TIMEOUT],
        oracleErrors: [eUSD_ORACLE_ERROR],
        holder: eUSD_HOLDER,
      },
    ],
    oracleTimeout: PRICE_TIMEOUT, // max
    oracleError: ORACLE_ERROR, // combined
    amountScaleDivisor: bn('1e2'),
    toleranceDivisor: bn('1e2'),
  },
]

all.forEach((curr: AeroStablePoolEnumeration) => {
  const defaultCollateralOpts: AeroStableCollateralOpts = {
    erc20: ZERO_ADDRESS,
    targetName: ethers.utils.formatBytes32String('USD'),
    priceTimeout: PRICE_TIMEOUT,
    chainlinkFeed: curr.tokens[0].feeds[0], // unused but cannot be zero
    oracleTimeout: curr.oracleTimeout, // max of oracleTimeouts
    oracleError: curr.oracleError, // combined oracle error
    maxTradeVolume: MAX_TRADE_VOL,
    defaultThreshold: DEFAULT_THRESHOLD,
    delayUntilDefault: DELAY_UNTIL_DEFAULT,
    pool: curr.pool,
    poolType: AerodromePoolType.Stable,
    gauge: curr.gauge,
    feeds: [curr.tokens[0].feeds, curr.tokens[1].feeds],
    oracleTimeouts: [curr.tokens[0].oracleTimeouts, curr.tokens[1].oracleTimeouts],
    oracleErrors: [curr.tokens[0].oracleErrors, curr.tokens[1].oracleErrors],
  }

  const deployCollateral = async (
    opts: AeroStableCollateralOpts = {}
  ): Promise<TestICollateral> => {
    let pool: IAeroPool
    let wrapper: AerodromeGaugeWrapper

    if (!opts.erc20) {
      const AerodromGaugeWrapperFactory = <AerodromeGaugeWrapper__factory>(
        await ethers.getContractFactory('AerodromeGaugeWrapper')
      )

      // Create wrapper
      pool = <IAeroPool>await ethers.getContractAt('IAeroPool', curr.pool)

      wrapper = await AerodromGaugeWrapperFactory.deploy(
        pool.address,
        'w' + (await pool.name()),
        'w' + (await pool.symbol()),
        AERO,
        curr.gauge
      )

      opts.erc20 = wrapper.address
    }

    opts = { ...defaultCollateralOpts, ...opts }

    const AeroStableCollateralFactory: ContractFactory = await ethers.getContractFactory(
      'AerodromeStableCollateral'
    )

    const collateral = <TestICollateral>await AeroStableCollateralFactory.deploy(
      {
        erc20: opts.erc20,
        targetName: opts.targetName,
        priceTimeout: opts.priceTimeout,
        chainlinkFeed: opts.chainlinkFeed,
        oracleError: opts.oracleError,
        oracleTimeout: opts.oracleTimeout,
        maxTradeVolume: opts.maxTradeVolume,
        defaultThreshold: opts.defaultThreshold,
        delayUntilDefault: opts.delayUntilDefault,
      },
      {
        pool: opts.pool,
        poolType: opts.poolType,
        feeds: opts.feeds,
        oracleTimeouts: opts.oracleTimeouts,
        oracleErrors: opts.oracleErrors,
      },
      { gasLimit: 2000000000 }
    )
    await collateral.deployed()

    // Push forward chainlink feeds
    await pushAllFeedsForward(collateral)

    // sometimes we are trying to test a negative test case and we want this to fail silently
    // fortunately this syntax fails silently because our tools are terrible
    await expect(collateral.refresh())

    return collateral
  }

  type Fixture<T> = () => Promise<T>

  const makeCollateralFixtureContext = (
    alice: SignerWithAddress,
    opts: AeroStableCollateralOpts = {}
  ): Fixture<AerodromeCollateralFixtureContext> => {
    const collateralOpts = { ...defaultCollateralOpts, ...opts }

    const makeCollateralFixtureContext = async () => {
      const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
        await ethers.getContractFactory('MockV3Aggregator')
      )

      // Substitute both feeds
      const token0Feed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
      collateralOpts.chainlinkFeed = token0Feed.address

      const token1Feed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
      collateralOpts.feeds = [[token0Feed.address], [token1Feed.address]]

      const pool = <IAeroPool>await ethers.getContractAt('IAeroPool', curr.pool)

      const AerodromeGaugeWrapperFactory = <AerodromeGaugeWrapper__factory>(
        await ethers.getContractFactory('AerodromeGaugeWrapper')
      )

      const wrapper = await AerodromeGaugeWrapperFactory.deploy(
        pool.address,
        'w' + (await pool.name()),
        'w' + (await pool.symbol()),
        AERO,
        curr.gauge
      )

      collateralOpts.erc20 = wrapper.address

      const collateral = await deployCollateral(collateralOpts)
      const erc20 = await ethers.getContractAt(
        'AerodromeGaugeWrapper',
        (await collateral.erc20()) as string
      )

      const rewardToken = <ERC20Mock>await ethers.getContractAt('ERC20Mock', AERO)

      return {
        alice,
        collateral,
        chainlinkFeed: token0Feed,
        tok: erc20,
        rewardToken,
      }
    }

    return makeCollateralFixtureContext
  }

  /*
  Define helper functions
*/

  const mintCollateralTo: MintCollateralFunc<CollateralFixtureContext> = async (
    ctx: CollateralFixtureContext,
    amount: BigNumberish,
    user: SignerWithAddress,
    recipient: string
  ) => {
    const gauge = await ethers.getContractAt('IAeroGauge', curr.gauge)
    const pool = await ethers.getContractAt('IAeroPool', curr.pool)

    await mintWrappedLpToken(
      ctx.tok as AerodromeGaugeWrapper,
      gauge,
      pool,
      amount,
      curr.holder,
      user,
      recipient
    )
  }

  const reduceTargetPerRef = async (ctx: CollateralFixtureContext, pctDecrease: BigNumberish) => {
    const allFeeds = await getFeeds(ctx.collateral)
    const initialPrices = await Promise.all(allFeeds.map((f) => f.latestRoundData()))
    for (const [i, feed] of allFeeds.entries()) {
      const nextAnswer = initialPrices[i].answer.sub(
        initialPrices[i].answer.mul(pctDecrease).div(100)
      )
      await feed.updateAnswer(nextAnswer)
    }
  }

  const increaseTargetPerRef = async (ctx: CollateralFixtureContext, pctIncrease: BigNumberish) => {
    // Update values in Oracles increase by 10%
    const allFeeds = await getFeeds(ctx.collateral)
    const initialPrices = await Promise.all(allFeeds.map((f) => f.latestRoundData()))
    for (const [i, feed] of allFeeds.entries()) {
      const nextAnswer = initialPrices[i].answer.add(
        initialPrices[i].answer.mul(pctIncrease).div(100)
      )
      await feed.updateAnswer(nextAnswer)
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  const increaseRefPerTok = async (ctx: CollateralFixtureContext, pctIncrease: BigNumberish) => {}

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  const reduceRefPerTok = async (ctx: CollateralFixtureContext, pctDecrease: BigNumberish) => {}

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  const collateralSpecificConstructorTests = () => {}

  const collateralSpecificStatusTests = () => {
    it('prices change as feed price changes', async () => {
      const MockV3AggregatorFactory = await ethers.getContractFactory('MockV3Aggregator')
      const feed0 = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
      const feed1 = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))

      const coll = await deployCollateral({
        pool: curr.pool,
        gauge: curr.gauge,
        feeds: [[feed0.address], [feed1.address]],
      })

      const initialRefPerTok = await coll.refPerTok()
      const [low, high] = await coll.price()

      // Update values in Oracles increase by 10%
      const allFeeds = await getFeeds(coll)
      const initialPrices = await Promise.all(allFeeds.map((f) => f.latestRoundData()))
      for (const [i, feed] of allFeeds.entries()) {
        await feed.updateAnswer(initialPrices[i].answer.mul(110).div(100)).then((e) => e.wait())
      }

      const [newLow, newHigh] = await coll.price()

      // with 18 decimals of price precision a 1e-9 tolerance seems fine for a 10% change
      expect(newLow).to.be.closeTo(low.mul(110).div(100), fp('1e-9'))
      expect(newHigh).to.be.closeTo(high.mul(110).div(100), fp('1e-9'))

      // Check refPerTok remains the same
      const finalRefPerTok = await coll.refPerTok()
      expect(finalRefPerTok).to.equal(initialRefPerTok)
    })

    it('prices change as targetPerRef changes', async () => {
      const MockV3AggregatorFactory = await ethers.getContractFactory('MockV3Aggregator')
      const feed0 = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
      const feed1 = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))

      const coll = await deployCollateral({
        pool: curr.pool,
        gauge: curr.gauge,
        feeds: [[feed0.address], [feed1.address]],
      })

      const tok = await ethers.getContractAt('IERC20Metadata', await coll.erc20())
      const tempCtx = { collateral: coll, chainlinkFeed: feed0, tok }

      const oracleError = await coll.oracleError()
      const expectedPrice = await getExpectedPrice(tempCtx)
      await expectPrice(coll.address, expectedPrice, oracleError, true, curr.toleranceDivisor)

      // Get refPerTok initial values
      const initialRefPerTok = await coll.refPerTok()
      const [oldLow, oldHigh] = await coll.price()

      // Update values in Oracles increase by 10-20%
      await increaseTargetPerRef(tempCtx, 20)

      // Check new prices -- increase expected
      const newPrice = await getExpectedPrice(tempCtx)
      await expectPrice(coll.address, newPrice, oracleError, true, curr.toleranceDivisor)
      const [newLow, newHigh] = await coll.price()
      expect(oldLow).to.be.lt(newLow)
      expect(oldHigh).to.be.lt(newHigh)

      // Check refPerTok remains the same
      const finalRefPerTok = await coll.refPerTok()
      expect(finalRefPerTok).to.equal(initialRefPerTok)
    })

    it('reverts if Chainlink feed reverts or runs out of gas, maintains status', async () => {
      const InvalidMockV3AggregatorFactory = await ethers.getContractFactory(
        'InvalidMockV3Aggregator'
      )
      const invalidChainlinkFeed = <InvalidMockV3Aggregator>(
        await InvalidMockV3AggregatorFactory.deploy(6, bn('1e6'))
      )

      const invalidCollateral = await deployCollateral({
        pool: curr.pool,
        gauge: curr.gauge,
        feeds: [[invalidChainlinkFeed.address], [invalidChainlinkFeed.address]],
      })

      // Reverting with no reason
      await invalidChainlinkFeed.setSimplyRevert(true)
      await expect(invalidCollateral.refresh()).to.be.revertedWithoutReason()
      expect(await invalidCollateral.status()).to.equal(CollateralStatus.SOUND)

      // Runnning out of gas (same error)
      await invalidChainlinkFeed.setSimplyRevert(false)
      await expect(invalidCollateral.refresh()).to.be.revertedWithoutReason()
      expect(await invalidCollateral.status()).to.equal(CollateralStatus.SOUND)
    })
  }

  const getExpectedPrice = async (ctx: CollateralFixtureContext) => {
    const initRefPerTok = await ctx.collateral.refPerTok()
    const coll = await ethers.getContractAt('AerodromeStableCollateral', ctx.collateral.address)

    const feed0 = await ethers.getContractAt('MockV3Aggregator', (await coll.tokenFeeds(0))[0])
    const decimals0 = await feed0.decimals()
    const initData0 = await feed0.latestRoundData()

    const feed1 = await ethers.getContractAt('MockV3Aggregator', (await coll.tokenFeeds(1))[0])
    const decimals1 = await feed1.decimals()
    const initData1 = await feed1.latestRoundData()

    const avgPrice = initData0.answer
      .mul(bn(10).pow(18 - decimals0))
      .add(initData1.answer.mul(bn(10).pow(18 - decimals1)))
      .div(2)

    return avgPrice.mul(initRefPerTok).div(fp('1'))
  }

  /*
    Run the test suite
  */

  const emptyFn = () => {
    return
  }

  const opts = {
    deployCollateral,
    collateralSpecificConstructorTests,
    collateralSpecificStatusTests,
    beforeEachRewardsTest: emptyFn,
    makeCollateralFixtureContext,
    mintCollateralTo,
    reduceTargetPerRef,
    increaseTargetPerRef,
    reduceRefPerTok,
    increaseRefPerTok,
    getExpectedPrice,
    itClaimsRewards: it,
    itChecksTargetPerRefDefault: it,
    itChecksTargetPerRefDefaultUp: it,
    itChecksRefPerTokDefault: it.skip,
    itChecksPriceChanges: it.skip,
    itChecksNonZeroDefaultThreshold: it,
    itChecksMainChainlinkOracleRevert: it.skip,
    itHasRevenueHiding: it.skip,
    resetFork,
    collateralName: curr.testName,
    chainlinkDefaultAnswer: bn('1e8'),
    itIsPricedByPeg: true,
    toleranceDivisor: curr.toleranceDivisor,
    amountScaleDivisor: curr.amountScaleDivisor,
    targetNetwork: 'base',
  }

  collateralTests(opts)
})
