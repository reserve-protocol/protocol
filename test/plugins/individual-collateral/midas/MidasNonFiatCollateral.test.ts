import { expect } from 'chai'
import { ethers } from 'hardhat'
import { ContractFactory, BigNumber, BigNumberish } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { bn, fp } from '#/common/numbers'
import { ZERO_ADDRESS } from '#/common/constants'
import {
  CollateralFixtureContext,
  CollateralOpts,
  CollateralStatus,
  MintCollateralFunc,
} from '../pluginTestTypes'
import {
  TestICollateral,
  MockV3Aggregator,
  MockV3Aggregator__factory,
  MockMidasDataFeed__factory,
  MockMToken__factory,
  IMToken,
  IERC20Metadata,
} from '#/typechain'
import { pushOracleForward } from '#/test/utils/oracles'
import { resetFork, mintMidasToken } from './helpers'
import {
  PRICE_TIMEOUT,
  CHAINLINK_ORACLE_TIMEOUT,
  ORACLE_ERROR,
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
  REVENUE_HIDING,
  midasContracts,
  MIDAS_ORACLE_TIMEOUT,
  BTC_FEED_DEFAULT_ANSWER,
  MBTC_FEED_DEFAULT_ANSWER,
  MAX_TRADE_VOL,
} from './constants'
import collateralTests from '../collateralTests'
import { MockMidasDataFeed } from '@typechain/MockMidasDataFeed'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { advanceTime } from '#/test/utils/time'

interface MidasNonFiatCollateralFixtureContext extends CollateralFixtureContext {
  tok: IERC20Metadata & IMToken
  mbtcAggregator: MockV3Aggregator
  mbtcDataFeed: MockMidasDataFeed
}

type MidasNonFiatCollateralOpts = CollateralOpts & {
  mbtcAggregator?: string
  mbtcDataFeed?: string
}

export const defaultMidasNonFiatCollateralOpts: MidasNonFiatCollateralOpts = {
  erc20: midasContracts.mBTC,
  targetName: ethers.utils.formatBytes32String('BTC'),
  chainlinkFeed: midasContracts.chainlinkFeeds.BTC,
  priceTimeout: PRICE_TIMEOUT,
  oracleTimeout: CHAINLINK_ORACLE_TIMEOUT,
  oracleError: ORACLE_ERROR,
  maxTradeVolume: MAX_TRADE_VOL,
  defaultThreshold: DEFAULT_THRESHOLD,
  delayUntilDefault: DELAY_UNTIL_DEFAULT,
  revenueHiding: REVENUE_HIDING,

  mbtcDataFeed: midasContracts.mbtcDataFeed,
  mbtcAggregator: midasContracts.mbtcAggregator,
}

async function deployCollateral(opts: MidasNonFiatCollateralOpts = {}): Promise<TestICollateral> {
  opts = { ...defaultMidasNonFiatCollateralOpts, ...opts }

  const MidasNonFiatCollFactory: ContractFactory = await ethers.getContractFactory(
    'MidasNonFiatCollateral'
  )

  const collateral = <TestICollateral>await MidasNonFiatCollFactory.deploy(
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
    opts.mbtcDataFeed,
    { gasLimit: 2000000000 }
  )
  await collateral.deployed()

  if (opts.chainlinkFeed && opts.chainlinkFeed !== ZERO_ADDRESS) {
    await pushOracleForward(opts.chainlinkFeed)
  }

  // sometimes we are trying to test a negative test case and we want this to fail silently
  // fortunately this syntax fails silently because our tools are terrible
  await expect(collateral.refresh())

  return collateral
}

type Fixture<T> = () => Promise<T>

const makeCollateralFixtureContext = (
  alice: SignerWithAddress,
  opts: MidasNonFiatCollateralOpts = {}
): Fixture<MidasNonFiatCollateralFixtureContext> => {
  const collateralOpts = { ...defaultMidasNonFiatCollateralOpts, ...opts }

  const makeCollateralFixtureContext = async () => {
    const chainlinkFactory = <MockV3Aggregator__factory>(
      await ethers.getContractFactory('MockV3Aggregator')
    )
    const midasDataFeedFactory = <MockMidasDataFeed__factory>(
      await ethers.getContractFactory('MockMidasDataFeed')
    )

    const chainlinkFeed = <MockV3Aggregator>(
      await chainlinkFactory.deploy(8, BTC_FEED_DEFAULT_ANSWER)
    ) // USD/BTC feed
    await chainlinkFeed.deployed()
    collateralOpts.chainlinkFeed = chainlinkFeed.address

    const mbtcAggregator = <MockV3Aggregator>(
      await chainlinkFactory.deploy(8, MBTC_FEED_DEFAULT_ANSWER)
    ) // BTC/mBTC feed
    await mbtcAggregator.deployed()
    collateralOpts.mbtcAggregator = mbtcAggregator.address

    const mbtcDataFeed = <MockMidasDataFeed>await midasDataFeedFactory.deploy()
    await mbtcDataFeed.deployed()
    collateralOpts.mbtcDataFeed = mbtcDataFeed.address

    await mbtcDataFeed.initialize(
      alice.address, // _ac: using alice for simplicity
      mbtcAggregator.address, // underlying aggregator for BTC/mToken price
      MIDAS_ORACLE_TIMEOUT, // healthyDiff: e.g. 30 days in seconds
      MBTC_FEED_DEFAULT_ANSWER.mul(98).div(100), // minExpectedAnswer
      MBTC_FEED_DEFAULT_ANSWER.mul(2) // maxExpectedAnswer
    )

    const mockMTokenFactory = <MockMToken__factory>await ethers.getContractFactory('MockMToken')
    const mockMidasToken = await mockMTokenFactory.deploy()
    await mockMidasToken.deployed()

    await mockMidasToken.initialize('Mock mBTC', 'mBTC')
    collateralOpts.erc20 = mockMidasToken.address

    const collateral = await deployCollateral(collateralOpts)

    return {
      alice,
      collateral,
      chainlinkFeed,
      mbtcAggregator,
      mbtcDataFeed,
      tok: mockMidasToken,
    }
  }

  return makeCollateralFixtureContext
}

const mintCollateralTo: MintCollateralFunc<MidasNonFiatCollateralFixtureContext> = async (
  ctx,
  amount,
  user,
  recipient
) => await mintMidasToken(ctx.tok, user, amount, recipient)

async function changeRefPerTok(ctx: MidasNonFiatCollateralFixtureContext, pctChange: BigNumberish) {
  const latest = await ctx.mbtcAggregator.latestRoundData()
  const newAnswer = latest.answer.add(latest.answer.mul(pctChange).div(100))
  await ctx.mbtcAggregator.updateAnswer(newAnswer)
}

const reduceRefPerTok = async (
  ctx: MidasNonFiatCollateralFixtureContext,
  pctDecrease: BigNumberish
) => await changeRefPerTok(ctx, bn(pctDecrease).mul(-1))

const increaseRefPerTok = async (
  ctx: MidasNonFiatCollateralFixtureContext,
  pctIncrease: BigNumberish
) => await changeRefPerTok(ctx, pctIncrease)

async function changeUoAPerBTC(ctx: MidasNonFiatCollateralFixtureContext, pctChange: BigNumberish) {
  const latest = await ctx.chainlinkFeed.latestRoundData()
  const newAnswer = latest.answer.add(latest.answer.mul(pctChange).div(100))
  await ctx.chainlinkFeed.updateAnswer(newAnswer)
}

const reduceTargetPerRef = async (
  ctx: MidasNonFiatCollateralFixtureContext,
  pctDecrease: BigNumberish
) => await changeUoAPerBTC(ctx, bn(pctDecrease).mul(-1))

const increaseTargetPerRef = async (
  ctx: MidasNonFiatCollateralFixtureContext,
  pctIncrease: BigNumberish
) => await changeUoAPerBTC(ctx, pctIncrease)

async function getExpectedPrice(ctx: MidasNonFiatCollateralFixtureContext): Promise<BigNumber> {
  // 1) USD/BTC from chainlink
  const chainlinkRound = await ctx.chainlinkFeed.latestRoundData()
  const chainlinkDecimals = await ctx.chainlinkFeed.decimals()
  const btcPrice = chainlinkRound.answer.mul(bn(10).pow(18 - chainlinkDecimals))

  // 2) BTC/mBTC from midas feed
  const mbtcPrice = await ctx.mbtcDataFeed.getDataInBase18()

  // final = (USD/BTC) * (BTC/mBTC) => USD/mBTC
  return btcPrice.mul(mbtcPrice).div(fp('1')) // dividing by 1e18
}

// eslint-disable-next-line @typescript-eslint/no-empty-function
const collateralSpecificConstructorTests = () => {
  // no-op
}

// eslint-disable-next-line @typescript-eslint/no-empty-function
async function beforeEachRewardsTest() {
  // no-op
}

const collateralSpecificStatusTests = () => {
  it('paused token => IFFY status', async () => {
    const [, alice] = await ethers.getSigners()
    const ctx = await loadFixture(makeCollateralFixtureContext(alice, {}))
    const { collateral, tok: mockToken } = ctx

    // Verify initial state is SOUND
    expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

    // Pause the token
    await mockToken.pause()
    expect(await mockToken.paused()).to.equal(true)

    // Refresh collateral and verify status becomes IFFY
    await collateral.refresh()
    expect(await collateral.status()).to.equal(CollateralStatus.IFFY)

    // Status should persist with multiple refreshes
    await collateral.refresh()
    expect(await collateral.status()).to.equal(CollateralStatus.IFFY)

    // Unpause and verify recovery to SOUND
    await mockToken.unpause()
    await collateral.refresh()
    expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
  })

  it('blacklisted => DISABLED status', async () => {
    const [, alice] = await ethers.getSigners()
    const ctx = await loadFixture(makeCollateralFixtureContext(alice, {}))
    const { collateral, tok: mockToken } = ctx

    // Verify initial state is SOUND
    expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

    // Get the BLACKLISTED_ROLE constant
    const BLACKLISTED_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes('BLACKLISTED_ROLE'))
    const mockAccessControl = await ethers.getContractAt(
      'MockMidasAccessControl',
      await mockToken.accessControl()
    )

    // Set token as blacklisted
    await mockAccessControl.setRole(BLACKLISTED_ROLE, collateral.address, true)

    // Refresh and verify immediate DISABLED status
    await collateral.refresh()
    expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)

    // Status should persist with multiple refreshes
    await collateral.refresh()
    expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)

    // Removing from blacklist should NOT change status (DISABLED is permanent)
    await mockAccessControl.setRole(BLACKLISTED_ROLE, collateral.address, false)
    await collateral.refresh()
    expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)
  })

  it('paused token eventually defaults after delay', async () => {
    const [, alice] = await ethers.getSigners()
    const ctx = await loadFixture(makeCollateralFixtureContext(alice, {}))
    const { collateral, tok: mockToken } = ctx

    // Verify initial state is SOUND
    expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

    // Pause the token
    await mockToken.pause()

    // Should become IFFY after refresh
    await collateral.refresh()
    expect(await collateral.status()).to.equal(CollateralStatus.IFFY)

    // Get the delay until default
    const delayUntilDefault = await collateral.delayUntilDefault()

    // Advance time past the delay until default
    await advanceTime(delayUntilDefault)

    // Should become DISABLED after the delay
    await collateral.refresh()
    expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)

    // Unpause should not recover from DISABLED state
    await mockToken.unpause()
    await collateral.refresh()
    expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)
  })

  it('handles both paused and blacklisted states correctly', async () => {
    const [, alice] = await ethers.getSigners()
    const ctx = await loadFixture(makeCollateralFixtureContext(alice, {}))
    const { collateral, tok: mockToken } = ctx

    // Verify initial state is SOUND
    expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

    // Pause the token first (should be IFFY)
    await mockToken.pause()
    await collateral.refresh()
    expect(await collateral.status()).to.equal(CollateralStatus.IFFY)

    // Then blacklist (should immediately become DISABLED)
    const BLACKLISTED_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes('BLACKLISTED_ROLE'))
    const mockAccessControl = await ethers.getContractAt(
      'MockMidasAccessControl',
      await mockToken.accessControl()
    )
    await mockAccessControl.setRole(BLACKLISTED_ROLE, collateral.address, true)

    await collateral.refresh()
    expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)

    // Cleanup
    await mockToken.unpause()
    await mockAccessControl.setRole(BLACKLISTED_ROLE, collateral.address, false)
  })
}

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
  itChecksNonZeroDefaultThreshold: it,
  itHasRevenueHiding: it,
  resetFork,
  collateralName: 'MidasNonFiatCollateral',
  chainlinkDefaultAnswer: BTC_FEED_DEFAULT_ANSWER,
  itIsPricedByPeg: true,
}

collateralTests(opts)
