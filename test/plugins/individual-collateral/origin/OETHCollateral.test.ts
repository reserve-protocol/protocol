import collateralTests from '../collateralTests'
import { setStorageAt, getStorageAt } from '@nomicfoundation/hardhat-network-helpers'
import { CollateralFixtureContext, CollateralOpts, MintCollateralFunc } from '../pluginTestTypes'
import { mintWOETH } from './helpers'
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
  FORK_BLOCK,
  PRICE_FEEDS,
  ORACLE_TIMEOUT,
  ORACLE_ERROR,
  WOETH,
  WOETH_WHALE,
} from './constants'
import { getResetFork } from '../helpers'

/*
  Define interfaces
*/
interface WOETHCollateralFixtureContext extends CollateralFixtureContext {
  woeth: IERC4626
  uoaPerTargetChainlinkFeed: MockV3Aggregator
  tok: IERC4626 & any // Override the tok type to match what we're returning
}

/*
  Define deployment functions
*/

interface WOETHCollateralOpts extends CollateralOpts {
  uoaPerTargetChainlinkFeed?: string
  uoaPerTargetChainlinkTimeout?: BigNumberish
}

export const defaultWOETHCollateralOpts: WOETHCollateralOpts = {
  erc20: WOETH,
  targetName: ethers.utils.formatBytes32String('ETH'),
  rewardERC20: ZERO_ADDRESS,
  priceTimeout: PRICE_TIMEOUT,
  chainlinkFeed: PRICE_FEEDS.OETH_ETH,
  oracleTimeout: '1000',
  oracleError: ORACLE_ERROR,
  maxTradeVolume: MAX_TRADE_VOL,
  defaultThreshold: DEFAULT_THRESHOLD,
  delayUntilDefault: DELAY_UNTIL_DEFAULT,
  uoaPerTargetChainlinkFeed: PRICE_FEEDS.ETH_USD,
  uoaPerTargetChainlinkTimeout: ORACLE_TIMEOUT,
  revenueHiding: fp('1e-4'),
}

export const deployCollateral = async (
  opts: WOETHCollateralOpts = {}
): Promise<TestICollateral> => {
  opts = { ...defaultWOETHCollateralOpts, ...opts }

  const WOETHCollateralFactory: ContractFactory = await ethers.getContractFactory('OETHCollateral')

  const collateral = <TestICollateral>await WOETHCollateralFactory.deploy(
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
    opts.uoaPerTargetChainlinkFeed,
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
  uoaPerTargetChainlinkFeed: bn('1800e8'),
  refPerTokenChainlinkFeed: bn('1.12e18'),
}

type Fixture<T> = () => Promise<T>

const makeCollateralFixtureContext = (
  alice: SignerWithAddress,
  opts: CollateralOpts = {}
): Fixture<WOETHCollateralFixtureContext> => {
  const collateralOpts = { ...defaultWOETHCollateralOpts, ...opts }

  const makeCollateralFixtureContext = async () => {
    const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
      await ethers.getContractFactory('MockV3Aggregator')
    )

    const uoaPerTargetChainlinkFeedMock = await MockV3AggregatorFactory.deploy(
      18,
      defaultAnswers.uoaPerTargetChainlinkFeed
    )

    const chainlinkFeedMock = await MockV3AggregatorFactory.deploy(
      18,
      defaultAnswers.targetPerRefChainlinkFeed
    )

    collateralOpts.chainlinkFeed = chainlinkFeedMock.address
    collateralOpts.uoaPerTargetChainlinkFeed = uoaPerTargetChainlinkFeedMock.address

    const woeth = (await ethers.getContractAt(
      '@openzeppelin/contracts/interfaces/IERC4626.sol:IERC4626',
      WOETH
    )) as IERC4626
    const rewardToken = (await ethers.getContractAt('ERC20Mock', ZERO_ADDRESS)) as ERC20Mock
    const collateral = await deployCollateral(collateralOpts)

    return {
      alice,
      collateral,
      woeth: woeth,
      tok: woeth,
      rewardToken,
      chainlinkFeed: chainlinkFeedMock,
      uoaPerTargetChainlinkFeed: uoaPerTargetChainlinkFeedMock,
    }
  }

  return makeCollateralFixtureContext
}

/*
  Define helper functions
*/

const mintCollateralTo: MintCollateralFunc<WOETHCollateralFixtureContext> = async (
  ctx: WOETHCollateralFixtureContext,
  amount: BigNumberish,
  user: SignerWithAddress,
  recipient: string
) => {
  await mintWOETH(ctx.woeth, user, amount, recipient, WOETH_WHALE)
}

const reduceTargetPerRef = async (
  ctx: WOETHCollateralFixtureContext,
  pctDecrease: BigNumberish
) => {
  const lastRound = await ctx.chainlinkFeed.latestRoundData()
  const nextAnswer = lastRound.answer.sub(lastRound.answer.mul(pctDecrease).div(100))
  await ctx.chainlinkFeed.updateAnswer(nextAnswer)
}

const increaseTargetPerRef = async (
  ctx: WOETHCollateralFixtureContext,
  pctIncrease: BigNumberish
) => {
  const lastRound = await ctx.chainlinkFeed.latestRoundData()
  const nextAnswer = lastRound.answer.add(lastRound.answer.mul(pctIncrease).div(100))
  await ctx.chainlinkFeed.updateAnswer(nextAnswer)
}

const reduceRefPerTok = async (ctx: WOETHCollateralFixtureContext, pctDecrease: BigNumberish) => {
  const slot = 2
  const storedTotalSupply = BigNumber.from(await getStorageAt(ctx.tok.address, slot))
  const newStoredTotalAssets = storedTotalSupply.add(storedTotalSupply.mul(pctDecrease).div(100))
  await setStorageAt(ctx.tok.address, slot, newStoredTotalAssets)
}

const increaseRefPerTok = async (ctx: WOETHCollateralFixtureContext, pctIncrease: BigNumberish) => {
  const slot = 2
  const storedTotalSupply = BigNumber.from(await getStorageAt(ctx.tok.address, slot))
  const newStoredTotalAssets = storedTotalSupply.sub(storedTotalSupply.mul(pctIncrease).div(100))
  await setStorageAt(ctx.tok.address, slot, newStoredTotalAssets)
}

const getExpectedPrice = async (ctx: WOETHCollateralFixtureContext): Promise<BigNumber> => {
  const uoaPerTargetChainlinkFeedAnswer = await ctx.uoaPerTargetChainlinkFeed.latestAnswer()
  const uoaPerTargetChainlinkFeedDecimals = await ctx.uoaPerTargetChainlinkFeed.decimals()
  const targetPerRefChainlinkFeedAnswer = await ctx.chainlinkFeed.latestAnswer()
  const targetPerRefChainlinkFeedDecimals = await ctx.chainlinkFeed.decimals()

  const refPerTok = await ctx.collateral.refPerTok()

  const result = uoaPerTargetChainlinkFeedAnswer
    .mul(targetPerRefChainlinkFeedAnswer)
    .mul(refPerTok)
    .div(bn(10).pow(uoaPerTargetChainlinkFeedDecimals + targetPerRefChainlinkFeedDecimals))

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
  itChecksTargetPerRefDefault: it,
  itChecksTargetPerRefDefaultUp: it,
  itChecksRefPerTokDefault: it,
  itChecksPriceChanges: it,
  itChecksNonZeroDefaultThreshold: it.skip,
  itHasRevenueHiding: it,
  resetFork: getResetFork(FORK_BLOCK),
  collateralName: 'OETHCollateral',
  chainlinkDefaultAnswer: defaultAnswers.targetPerRefChainlinkFeed,
  itIsPricedByPeg: true,
  itHasOracleRefPerTok: false,
  targetNetwork: 'mainnet',
  toleranceDivisor: bn('1e2'),
}

collateralTests(opts)
