import collateralTests from '../collateralTests'
import {
  CurveCollateralFixtureContext,
  CurveCollateralOpts,
  MintCurveCollateralFunc,
} from '../pluginTestTypes'
import { mintWPool, makeWTricryptoPoolVolatile, resetFork } from './helpers'
import { ethers } from 'hardhat'
import { ContractFactory, BigNumberish } from 'ethers'
import {
  ERC20Mock,
  MockV3Aggregator,
  MockV3Aggregator__factory,
  TestICollateral,
} from '../../../../../typechain'
import { bn } from '../../../../../common/numbers'
import { ZERO_ADDRESS } from '../../../../../common/constants'
import { expect } from 'chai'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  PRICE_TIMEOUT,
  CVX,
  USDT_ORACLE_TIMEOUT,
  USDT_ORACLE_ERROR,
  MAX_TRADE_VOL,
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
  CurvePoolType,
  CRV,
  TRI_CRYPTO_HOLDER,
  TRI_CRYPTO,
  TRI_CRYPTO_TOKEN,
  WBTC_BTC_FEED,
  BTC_USD_FEED,
  BTC_ORACLE_TIMEOUT,
  WETH_USD_FEED,
  WBTC_BTC_ORACLE_ERROR,
  WBTC_ORACLE_TIMEOUT,
  WETH_ORACLE_TIMEOUT,
  USDT_USD_FEED,
  BTC_USD_ORACLE_ERROR,
  WETH_ORACLE_ERROR,
} from '../constants'

type Fixture<T> = () => Promise<T>

export const defaultCvxVolatileCollateralOpts: CurveCollateralOpts = {
  erc20: ZERO_ADDRESS,
  targetName: ethers.utils.formatBytes32String('TRICRYPTO'),
  priceTimeout: PRICE_TIMEOUT,
  chainlinkFeed: USDT_USD_FEED, // unused but cannot be zero
  oracleTimeout: USDT_ORACLE_TIMEOUT, // max of oracleTimeouts
  oracleError: bn('1'), // unused but cannot be zero
  maxTradeVolume: MAX_TRADE_VOL,
  defaultThreshold: DEFAULT_THRESHOLD,
  delayUntilDefault: DELAY_UNTIL_DEFAULT,
  revenueHiding: bn('0'),
  nTokens: 3,
  curvePool: TRI_CRYPTO,
  lpToken: TRI_CRYPTO_TOKEN,
  poolType: CurvePoolType.Plain,
  feeds: [[USDT_USD_FEED], [WBTC_BTC_FEED, BTC_USD_FEED], [WETH_USD_FEED]],
  oracleTimeouts: [
    [USDT_ORACLE_TIMEOUT],
    [WBTC_ORACLE_TIMEOUT, BTC_ORACLE_TIMEOUT],
    [WETH_ORACLE_TIMEOUT],
  ],
  oracleErrors: [
    [USDT_ORACLE_ERROR],
    [WBTC_BTC_ORACLE_ERROR, BTC_USD_ORACLE_ERROR],
    [WETH_ORACLE_ERROR],
  ],
}

const makeFeeds = async () => {
  const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
    await ethers.getContractFactory('MockV3Aggregator')
  )

  // Substitute all 3 feeds: DAI, USDC, USDT
  const wethFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
  const wbtcFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
  const btcFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
  const usdtFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))

  const wethFeedOrg = MockV3AggregatorFactory.attach(WETH_USD_FEED)
  const wbtcFeedOrg = MockV3AggregatorFactory.attach(WBTC_BTC_FEED)
  const btcFeedOrg = MockV3AggregatorFactory.attach(BTC_USD_FEED)
  const usdtFeedOrg = MockV3AggregatorFactory.attach(USDT_USD_FEED)

  await wethFeed.updateAnswer(await wethFeedOrg.latestAnswer())
  await wbtcFeed.updateAnswer(await wbtcFeedOrg.latestAnswer())
  await btcFeed.updateAnswer(await btcFeedOrg.latestAnswer())
  await usdtFeed.updateAnswer(await usdtFeedOrg.latestAnswer())

  return { wethFeed, wbtcFeed, btcFeed, usdtFeed }
}

export const deployCollateral = async (
  opts: CurveCollateralOpts = {}
): Promise<[TestICollateral, CurveCollateralOpts]> => {
  if (!opts.erc20 && !opts.feeds) {
    const { wethFeed, wbtcFeed, btcFeed, usdtFeed } = await makeFeeds()

    const fix = await makeWTricryptoPoolVolatile()

    opts.feeds = [[wethFeed.address], [wbtcFeed.address, btcFeed.address], [usdtFeed.address]]
    opts.erc20 = fix.wrapper.address
  }

  opts = { ...defaultCvxVolatileCollateralOpts, ...opts }

  const CvxVolatileCollateralFactory: ContractFactory = await ethers.getContractFactory(
    'CurveVolatileCollateral'
  )

  const collateral = <TestICollateral>await CvxVolatileCollateralFactory.deploy(
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
    opts.revenueHiding,
    {
      nTokens: opts.nTokens,
      curvePool: opts.curvePool,
      poolType: opts.poolType,
      feeds: opts.feeds,
      oracleTimeouts: opts.oracleTimeouts,
      oracleErrors: opts.oracleErrors,
      lpToken: opts.lpToken,
    }
  )
  await collateral.deployed()

  // sometimes we are trying to test a negative test case and we want this to fail silently
  // fortunately this syntax fails silently because our tools are terrible
  await expect(collateral.refresh())

  return [collateral, opts]
}

const makeCollateralFixtureContext = (
  alice: SignerWithAddress,
  opts: CurveCollateralOpts = {}
): Fixture<CurveCollateralFixtureContext> => {
  const collateralOpts = { ...defaultCvxVolatileCollateralOpts, ...opts }

  const makeCollateralFixtureContext = async () => {
    const { wethFeed, wbtcFeed, btcFeed, usdtFeed } = await makeFeeds()

    collateralOpts.feeds = [
      [usdtFeed.address],
      [wbtcFeed.address, btcFeed.address],
      [wethFeed.address],
    ]

    const fix = await makeWTricryptoPoolVolatile()

    collateralOpts.erc20 = fix.wrapper.address
    collateralOpts.curvePool = fix.curvePool.address
    const collateral = <TestICollateral>((await deployCollateral(collateralOpts))[0] as unknown)
    const cvx = <ERC20Mock>await ethers.getContractAt('ERC20Mock', CVX)
    const crv = <ERC20Mock>await ethers.getContractAt('ERC20Mock', CRV)

    return {
      alice,
      collateral,
      curvePool: fix.curvePool,
      wrapper: fix.wrapper,
      rewardTokens: [cvx, crv],
      poolTokens: [fix.usdt, fix.wbtc, fix.weth],
      feeds: [usdtFeed, btcFeed, wethFeed], // exclude wbtcFeed
    }
  }

  return makeCollateralFixtureContext
}

/*
  Define helper functions
*/

const mintCollateralTo: MintCurveCollateralFunc<CurveCollateralFixtureContext> = async (
  ctx: CurveCollateralFixtureContext,
  amount: BigNumberish,
  user: SignerWithAddress,
  recipient: string
) => {
  await mintWPool(ctx, amount, user, recipient, TRI_CRYPTO_HOLDER)
}

/*
  Define collateral-specific tests
*/

// eslint-disable-next-line @typescript-eslint/no-empty-function
const collateralSpecificConstructorTests = () => {}

// eslint-disable-next-line @typescript-eslint/no-empty-function
const collateralSpecificStatusTests = () => {}

/*
  Run the test suite
*/

const opts = {
  deployCollateral,
  collateralSpecificConstructorTests,
  collateralSpecificStatusTests,
  makeCollateralFixtureContext,
  mintCollateralTo,
  itChecksTargetPerRefDefault: it,
  itChecksRefPerTokDefault: it,
  itHasRevenueHiding: it,
  isMetapool: false,
  resetFork,
  collateralName: 'CurveVolatileCollateral  - ConvexStakingWrapper',
}

collateralTests(opts)
