import collateralTests from '../collateralTests'
import { CollateralFixtureContext, CollateralOpts, MintCollateralFunc } from '../pluginTestTypes'
import { ethers } from 'hardhat'
import { ContractFactory, BigNumberish, BigNumber } from 'ethers'
import {
  IAeroPool,
  MockV3Aggregator,
  MockV3Aggregator__factory,
  AerodromeGaugeWrapper__factory,
  TestICollateral,
  AerodromeGaugeWrapper,
  ERC20Mock,
} from '../../../../typechain'
import { ZERO_ADDRESS } from '#/common/constants'
import { bn, fp } from '../../../../common/numbers'
import { expect } from 'chai'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  AerodromePoolType,
  MOG_USD_FEED,
  MOG_HOLDER,
  MOG_ORACLE_ERROR,
  MOG_ORACLE_TIMEOUT,
  PRICE_TIMEOUT,
  MAX_TRADE_VOL,
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
  AERO_MOG_WETH_POOL,
  AERO_MOG_WETH_GAUGE,
  AERO_MOG_WETH_HOLDER,
  AERO,
  AERO_USD_FEED,
  AERO_ORACLE_ERROR,
  AERO_ORACLE_TIMEOUT,
  AERO_HOLDER,
  MOG,
  WETH,
  WETH_HOLDER,
  AERO_WETH_AERO_POOL,
  AERO_WETH_AERO_GAUGE,
  AERO_WETH_AERO_HOLDER,
  ETH_USD_FEED,
  ETH_ORACLE_ERROR,
  ETH_ORACLE_TIMEOUT,
} from './constants'
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

interface AeroVolatilePoolEnumeration {
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

interface AeroVolatileCollateralOpts extends CollateralOpts {
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

// Test all Aerodrome Volatile pools
const all: AeroVolatilePoolEnumeration[] = [
  {
    testName: 'Aerodrome - MOG/WETH Volatile',
    pool: AERO_MOG_WETH_POOL,
    gauge: AERO_MOG_WETH_GAUGE,
    holder: AERO_MOG_WETH_HOLDER,
    tokens: [
      {
        token: MOG,
        feeds: [MOG_USD_FEED],
        oracleTimeouts: [MOG_ORACLE_TIMEOUT],
        oracleErrors: [MOG_ORACLE_ERROR],
        holder: MOG_HOLDER,
      },
      {
        token: WETH,
        feeds: [ETH_USD_FEED],
        oracleTimeouts: [ETH_ORACLE_TIMEOUT],
        oracleErrors: [ETH_ORACLE_ERROR],
        holder: WETH_HOLDER,
      },
    ],
    oracleTimeout: MOG_ORACLE_TIMEOUT, // max
    oracleError: MOG_ORACLE_ERROR.add(ETH_ORACLE_ERROR), // combined
    amountScaleDivisor: bn('1'),
    toleranceDivisor: bn('1e4'),
  },
  {
    testName: 'Aerodrome - WETH/AERO Volatile',
    pool: AERO_WETH_AERO_POOL,
    gauge: AERO_WETH_AERO_GAUGE,
    holder: AERO_WETH_AERO_HOLDER,
    tokens: [
      {
        token: WETH,
        feeds: [ETH_USD_FEED],
        oracleTimeouts: [ETH_ORACLE_TIMEOUT],
        oracleErrors: [ETH_ORACLE_ERROR],
        holder: WETH_HOLDER,
      },
      {
        token: AERO,
        feeds: [AERO_USD_FEED],
        oracleTimeouts: [AERO_ORACLE_TIMEOUT],
        oracleErrors: [AERO_ORACLE_ERROR],
        holder: AERO_HOLDER,
      },
    ],
    oracleTimeout: AERO_ORACLE_TIMEOUT, // max
    oracleError: AERO_ORACLE_ERROR.add(ETH_ORACLE_ERROR), // combined
    amountScaleDivisor: bn('1e2'),
    toleranceDivisor: bn('1e4'),
  },
]

all.forEach((curr: AeroVolatilePoolEnumeration) => {
  const defaultCollateralOpts: AeroVolatileCollateralOpts = {
    erc20: ZERO_ADDRESS,
    targetName: ethers.utils.formatBytes32String('ETH'), // good enough to test swapping out
    priceTimeout: PRICE_TIMEOUT,
    chainlinkFeed: curr.tokens[0].feeds[0], // unused but cannot be zero
    oracleTimeout: curr.oracleTimeout, // max of oracleTimeouts
    oracleError: curr.oracleError, // combined oracle error
    maxTradeVolume: MAX_TRADE_VOL,
    defaultThreshold: DEFAULT_THRESHOLD,
    delayUntilDefault: DELAY_UNTIL_DEFAULT,
    pool: curr.pool,
    poolType: AerodromePoolType.Volatile,
    gauge: curr.gauge,
    feeds: [curr.tokens[0].feeds, curr.tokens[1].feeds],
    oracleTimeouts: [curr.tokens[0].oracleTimeouts, curr.tokens[1].oracleTimeouts],
    oracleErrors: [curr.tokens[0].oracleErrors, curr.tokens[1].oracleErrors],
  }

  const deployCollateral = async (
    opts: AeroVolatileCollateralOpts = {}
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
    opts.feeds![0][0] = opts.chainlinkFeed!

    const AeroVolatileCollateralFactory: ContractFactory = await ethers.getContractFactory(
      'AerodromeVolatileCollateral'
    )

    const collateral = <TestICollateral>await AeroVolatileCollateralFactory.deploy(
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
    opts: AeroVolatileCollateralOpts = {}
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

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  const reduceTargetPerRef = async () => {}

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  const increaseTargetPerRef = async () => {}

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  const increaseRefPerTok = async () => {}

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  const reduceRefPerTok = async () => {}

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

      // Check refPerTok remains _exactly_ the same
      const finalRefPerTok = await coll.refPerTok()
      expect(finalRefPerTok).to.equal(initialRefPerTok)
    })
  }

  const getExpectedPrice = async (ctx: CollateralFixtureContext) => {
    const initRefPerTok = await ctx.collateral.refPerTok()
    const coll = await ethers.getContractAt('AerodromeVolatileCollateral', ctx.collateral.address)

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
    itChecksTargetPerRefDefault: it.skip,
    itChecksTargetPerRefDefaultUp: it.skip,
    itChecksRefPerTokDefault: it.skip,
    itChecksPriceChanges: it.skip,
    itChecksNonZeroDefaultThreshold: it.skip,
    itHasRevenueHiding: it.skip,
    resetFork,
    collateralName: curr.testName,
    chainlinkDefaultAnswer: bn('1e8'),
    itIsPricedByPeg: false,
    toleranceDivisor: curr.toleranceDivisor,
    amountScaleDivisor: curr.amountScaleDivisor,
    targetNetwork: 'base',
  }

  collateralTests(opts)
})
