import { expect } from 'chai'
import { ethers } from 'hardhat'
import { ContractFactory, BigNumber, BigNumberish } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { bn } from '#/common/numbers'
import { ZERO_ADDRESS } from '#/common/constants'
import {
  CollateralFixtureContext,
  CollateralOpts,
  CollateralStatus,
  MintCollateralFunc,
} from '../pluginTestTypes'
import {
  TestICollateral,
  MockMidasDataFeed__factory,
  MockMToken__factory,
  IMToken,
  IERC20Metadata,
  MockV3Aggregator__factory,
  MockV3Aggregator,
} from '#/typechain'
import { resetFork, mintMidasToken } from './helpers'
import {
  PRICE_TIMEOUT,
  ORACLE_ERROR,
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
  REVENUE_HIDING,
  midasContracts,
  MIDAS_ORACLE_TIMEOUT,
  MAX_TRADE_VOL,
  MTBILL_FEED_DEFAULT_ANSWER,
  USDC_FEED_DEFAULT_ANSWER,
  CHAINLINK_ORACLE_TIMEOUT,
} from './constants'
import collateralTests from '../collateralTests'
import { MockMidasDataFeed } from '@typechain/MockMidasDataFeed'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { advanceTime } from '#/test/utils/time'

interface MidasFiatCollateralFixtureContext extends CollateralFixtureContext {
  tok: IERC20Metadata & IMToken
  dataFeed: MockMidasDataFeed
  aggregator: MockV3Aggregator
}

type MidasFiatCollateralOpts = CollateralOpts & {
  dataFeed?: string
  aggregator?: string
}

export const defaultMidasFiatCollateralOpts: MidasFiatCollateralOpts = {
  erc20: midasContracts.mTBILL,
  targetName: ethers.utils.formatBytes32String('USD'),
  chainlinkFeed: midasContracts.chainlinkFeeds.USDC,
  priceTimeout: PRICE_TIMEOUT,
  oracleTimeout: CHAINLINK_ORACLE_TIMEOUT,
  oracleError: ORACLE_ERROR,
  maxTradeVolume: MAX_TRADE_VOL,
  defaultThreshold: DEFAULT_THRESHOLD,
  delayUntilDefault: DELAY_UNTIL_DEFAULT,
  revenueHiding: REVENUE_HIDING,

  dataFeed: midasContracts.mtbillDataFeed,
  aggregator: midasContracts.mtbillAggregator,
}

async function deployCollateral(opts: MidasFiatCollateralOpts = {}): Promise<TestICollateral> {
  opts = { ...defaultMidasFiatCollateralOpts, ...opts }

  const MidasFiatCollFactory: ContractFactory = await ethers.getContractFactory(
    'MidasFiatCollateral'
  )

  const collateral = <TestICollateral>await MidasFiatCollFactory.deploy(
    {
      erc20: opts.erc20,
      targetName: opts.targetName,
      priceTimeout: opts.priceTimeout,
      chainlinkFeed: opts.chainlinkFeed, // zero address
      oracleError: opts.oracleError,
      oracleTimeout: opts.oracleTimeout, // not used, but required by constructor
      maxTradeVolume: opts.maxTradeVolume,
      defaultThreshold: opts.defaultThreshold,
      delayUntilDefault: opts.delayUntilDefault,
    },
    opts.revenueHiding,
    opts.dataFeed,
    { gasLimit: 2000000000 }
  )
  await collateral.deployed()

  // sometimes we are trying to test a negative test case and we want this to fail silently
  // fortunately this syntax fails silently because our tools are terrible
  await expect(collateral.refresh())

  return collateral
}

type Fixture<T> = () => Promise<T>

export const makeCollateralFixtureContext = (
  alice: SignerWithAddress,
  opts: MidasFiatCollateralOpts = {}
): Fixture<MidasFiatCollateralFixtureContext> => {
  const collateralOpts = { ...defaultMidasFiatCollateralOpts, ...opts }

  const makeCollateralFixtureContext = async () => {
    const chainlinkFactory = <MockV3Aggregator__factory>(
      await ethers.getContractFactory('MockV3Aggregator')
    )
    const midasDataFeedFactory = <MockMidasDataFeed__factory>(
      await ethers.getContractFactory('MockMidasDataFeed')
    )

    const chainlinkFeed = <MockV3Aggregator>(
      await chainlinkFactory.deploy(8, USDC_FEED_DEFAULT_ANSWER)
    )
    await chainlinkFeed.deployed()
    collateralOpts.chainlinkFeed = chainlinkFeed.address

    // Mock aggregator for USD/mTBILL price
    const aggregator = <MockV3Aggregator>(
      await chainlinkFactory.deploy(8, MTBILL_FEED_DEFAULT_ANSWER)
    )
    await aggregator.deployed()
    collateralOpts.aggregator = aggregator.address

    // Mock data feed
    const dataFeed = <MockMidasDataFeed>await midasDataFeedFactory.deploy()
    await dataFeed.deployed()
    collateralOpts.dataFeed = dataFeed.address

    await dataFeed.initialize(
      alice.address, // _ac: using alice for simplicity
      aggregator.address, // underlying aggregator for USD/mToken price
      MIDAS_ORACLE_TIMEOUT, // healthyDiff: e.g. 30 days in seconds
      MTBILL_FEED_DEFAULT_ANSWER.mul(98).div(100), // minExpectedAnswer
      MTBILL_FEED_DEFAULT_ANSWER.mul(2) // maxExpectedAnswer
    )

    const mockMTokenFactory = <MockMToken__factory>await ethers.getContractFactory('MockMToken')
    const mockMidasToken = await mockMTokenFactory.deploy()
    await mockMidasToken.deployed()

    await mockMidasToken.initialize('Mock mTBILL', 'mTBILL')
    collateralOpts.erc20 = mockMidasToken.address

    const collateral = await deployCollateral(collateralOpts)

    return {
      alice,
      collateral,
      chainlinkFeed,
      aggregator,
      dataFeed,
      tok: mockMidasToken,
    }
  }

  return makeCollateralFixtureContext
}

const mintCollateralTo: MintCollateralFunc<MidasFiatCollateralFixtureContext> = async (
  ctx,
  amount,
  user,
  recipient
) => await mintMidasToken(ctx.tok, user, amount, recipient)

// eslint-disable-next-line @typescript-eslint/no-empty-function
async function changeRefPerTok(ctx: MidasFiatCollateralFixtureContext, pctChange: BigNumberish) {
  // no-op
}

const reduceRefPerTok = async (ctx: MidasFiatCollateralFixtureContext, pctDecrease: BigNumberish) =>
  await changeRefPerTok(ctx, bn(pctDecrease).mul(-1))

const increaseRefPerTok = async (
  ctx: MidasFiatCollateralFixtureContext,
  pctIncrease: BigNumberish
) => await changeRefPerTok(ctx, pctIncrease)

// eslint-disable-next-line @typescript-eslint/no-empty-function
async function changeTargetPerRef(ctx: MidasFiatCollateralFixtureContext, pctChange: BigNumberish) {
  // no-op
}

const reduceTargetPerRef = async (
  ctx: MidasFiatCollateralFixtureContext,
  pctDecrease: BigNumberish
) => await changeTargetPerRef(ctx, bn(pctDecrease).mul(-1))

const increaseTargetPerRef = async (
  ctx: MidasFiatCollateralFixtureContext,
  pctIncrease: BigNumberish
) => await changeTargetPerRef(ctx, pctIncrease)

async function getExpectedPrice(ctx: MidasFiatCollateralFixtureContext): Promise<BigNumber> {
  return ctx.dataFeed.getDataInBase18()
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
  itChecksRefPerTokDefault: it.skip,
  itChecksPriceChanges: it,
  itChecksNonZeroDefaultThreshold: it,
  itHasRevenueHiding: it,
  resetFork,
  collateralName: 'MidasFiatCollateral',
  chainlinkDefaultAnswer: MTBILL_FEED_DEFAULT_ANSWER,
  itIsPricedByPeg: false,
}

collateralTests(opts)
