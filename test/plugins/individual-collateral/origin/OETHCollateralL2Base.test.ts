import collateralTests from '../collateralTests'
import { setStorageAt, getStorageAt } from '@nomicfoundation/hardhat-network-helpers'
import { CollateralFixtureContext, CollateralOpts, MintCollateralFunc } from '../pluginTestTypes'
import { mintWSUPEROETHB } from './helpers'
import { expect } from 'chai'
import { ethers } from 'hardhat'
import { ContractFactory, BigNumber, BigNumberish } from 'ethers'
import {
  ERC20Mock,
  MockV3Aggregator,
  MockV3Aggregator__factory,
  TestICollateral,
  IERC4626,
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
  BASE_WSUPEROETHB,
  BASE_WSUPEROETHB_WHALE,
} from './constants'
import { getResetFork } from '../helpers'

/*
  Define interfaces
*/
interface WSUPEROETHBCollateralFixtureContext extends CollateralFixtureContext {
  wsuperoethb: IERC4626
  targetPerRefChainlinkFeed: MockV3Aggregator
  uoaPerTargetChainlinkFeed: MockV3Aggregator
}

/*
  Define deployment functions
*/

interface WSUPEROETHBCollateralOpts extends CollateralOpts {
  targetPerTokChainlinkFeed?: string
  uoaPerTargetChainlinkFeed?: string
  uoaPerTargetChainlinkTimeout?: BigNumberish
}

export const defaultWSUPEROETHBCollateralOpts: WSUPEROETHBCollateralOpts = {
  erc20: BASE_WSUPEROETHB,
  targetName: ethers.utils.formatBytes32String('ETH'),
  rewardERC20: ZERO_ADDRESS,
  priceTimeout: PRICE_TIMEOUT,
  chainlinkFeed: BASE_PRICE_FEEDS.ETH_USD, // ignored
  oracleTimeout: '1000', // ignored
  oracleError: BASE_ORACLE_ERROR,
  maxTradeVolume: MAX_TRADE_VOL,
  defaultThreshold: DEFAULT_THRESHOLD,
  delayUntilDefault: DELAY_UNTIL_DEFAULT,
  uoaPerTargetChainlinkFeed: BASE_PRICE_FEEDS.ETH_USD,
  uoaPerTargetChainlinkTimeout: BASE_FEEDS_TIMEOUT.ETH_USD,
  revenueHiding: fp('1e-4'),
}

export const deployCollateral = async (
  opts: WSUPEROETHBCollateralOpts = {}
): Promise<TestICollateral> => {
  opts = { ...defaultWSUPEROETHBCollateralOpts, ...opts }

  const WSuperOETHbCollateralFactory: ContractFactory = await ethers.getContractFactory(
    'OETHCollateralL2Base'
  )

  const collateral = <TestICollateral>await WSuperOETHbCollateralFactory.deploy(
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
    opts.chainlinkFeed ?? opts.uoaPerTargetChainlinkFeed,
    opts.uoaPerTargetChainlinkTimeout,
    { gasLimit: 2000000000 }
  )

  // Push forward chainlink feed
  await pushOracleForward(opts.uoaPerTargetChainlinkFeed!)

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
): Fixture<WSUPEROETHBCollateralFixtureContext> => {
  const collateralOpts = { ...defaultWSUPEROETHBCollateralOpts, ...opts }

  const makeCollateralFixtureContext = async () => {
    const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
      await ethers.getContractFactory('MockV3Aggregator')
    )

    const targetPerRefChainlinkFeed = await MockV3AggregatorFactory.deploy(
      18,
      defaultAnswers.targetPerRefChainlinkFeed
    )
    const uoaPerTargetChainlinkFeed = await MockV3AggregatorFactory.deploy(
      8,
      defaultAnswers.uoaPerTargetChainlinkFeed
    )

    collateralOpts.chainlinkFeed = uoaPerTargetChainlinkFeed.address
    collateralOpts.uoaPerTargetChainlinkFeed = uoaPerTargetChainlinkFeed.address

    const wsuperOETHb = (await ethers.getContractAt(
      '@openzeppelin/contracts/interfaces/IERC4626.sol:IERC4626',
      BASE_WSUPEROETHB
    )) as IERC4626
    const rewardToken = (await ethers.getContractAt('ERC20Mock', ZERO_ADDRESS)) as ERC20Mock
    const collateral = await deployCollateral(collateralOpts)

    return {
      alice,
      collateral,
      wsuperoethb: wsuperOETHb,
      tok: wsuperOETHb,
      rewardToken,
      chainlinkFeed: uoaPerTargetChainlinkFeed,
      targetPerRefChainlinkFeed: targetPerRefChainlinkFeed,
      uoaPerTargetChainlinkFeed,
    }
  }

  return makeCollateralFixtureContext
}

/*
  Define helper functions
*/

const mintCollateralTo: MintCollateralFunc<WSUPEROETHBCollateralFixtureContext> = async (
  ctx: WSUPEROETHBCollateralFixtureContext,
  amount: BigNumberish,
  user: SignerWithAddress,
  recipient: string
) => {
  await mintWSUPEROETHB(ctx.wsuperoethb, user, amount, recipient, BASE_WSUPEROETHB_WHALE)
}

const reduceTargetPerRef = async (
  ctx: WSUPEROETHBCollateralFixtureContext,
  pctDecrease: BigNumberish
) => {
  const lastRound = await ctx.chainlinkFeed.latestRoundData()
  const nextAnswer = lastRound.answer.sub(lastRound.answer.mul(pctDecrease).div(100))
  await ctx.chainlinkFeed.updateAnswer(nextAnswer)
}

const increaseTargetPerRef = async (
  ctx: WSUPEROETHBCollateralFixtureContext,
  pctIncrease: BigNumberish
) => {
  const lastRound = await ctx.chainlinkFeed.latestRoundData()
  const nextAnswer = lastRound.answer.add(lastRound.answer.mul(pctIncrease).div(100))
  await ctx.chainlinkFeed.updateAnswer(nextAnswer)
}

const reduceRefPerTok = async (
  ctx: WSUPEROETHBCollateralFixtureContext,
  pctDecrease: BigNumberish
) => {
  const slot = 2
  const storedTotalSupply = BigNumber.from(await getStorageAt(ctx.tok.address, slot))
  const newStoredTotalAssets = storedTotalSupply.add(storedTotalSupply.mul(pctDecrease).div(100))
  await setStorageAt(ctx.tok.address, slot, newStoredTotalAssets)
}

const increaseRefPerTok = async (
  ctx: WSUPEROETHBCollateralFixtureContext,
  pctIncrease: BigNumberish
) => {
  const slot = 2
  const storedTotalSupply = BigNumber.from(await getStorageAt(ctx.tok.address, slot))
  const newStoredTotalAssets = storedTotalSupply.sub(storedTotalSupply.mul(pctIncrease).div(100))
  await setStorageAt(ctx.tok.address, slot, newStoredTotalAssets)
}

const getExpectedPrice = async (ctx: WSUPEROETHBCollateralFixtureContext): Promise<BigNumber> => {
  const uoaPerTargetChainlinkFeedAnswer = await ctx.uoaPerTargetChainlinkFeed.latestAnswer()
  const uoaPerTargetChainlinkFeedDecimals = await ctx.uoaPerTargetChainlinkFeed.decimals()

  const refPerTok = await ctx.collateral.refPerTok()

  const result = uoaPerTargetChainlinkFeedAnswer
    .mul(bn(10).pow(18 - uoaPerTargetChainlinkFeedDecimals))
    .mul(refPerTok)
    .div(fp('1'))

  return result
}

// eslint-disable-next-line @typescript-eslint/no-empty-function
const collateralSpecificConstructorTests = () => {}

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
  itChecksTargetPerRefDefault: it.skip,
  itChecksTargetPerRefDefaultUp: it.skip,
  itChecksRefPerTokDefault: it,
  itChecksPriceChanges: it,
  itChecksNonZeroDefaultThreshold: it.skip,
  itHasRevenueHiding: it,
  resetFork: getResetFork(FORK_BLOCK_BASE),
  collateralName: 'OETHCollateralL2Base',
  chainlinkDefaultAnswer: defaultAnswers.uoaPerTargetChainlinkFeed,
  itIsPricedByPeg: true,
  itHasOracleRefPerTok: true,
  targetNetwork: 'base',
  toleranceDivisor: bn('1e2'),
}

collateralTests(opts)
