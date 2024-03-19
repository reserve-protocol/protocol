import collateralTests from '../collateralTests'
import { CollateralFixtureContext, CollateralOpts, MintCollateralFunc } from '../pluginTestTypes'
import { resetFork, mintAnkrETH } from './helpers'
import { ethers } from 'hardhat'
import { expect } from 'chai'
import { ContractFactory, BigNumberish, BigNumber } from 'ethers'
import {
  MockV3Aggregator,
  MockV3Aggregator__factory,
  TestICollateral,
  IAnkrETH,
} from '../../../../typechain'
import { pushOracleForward } from '../../../utils/oracles'
import { bn, fp } from '../../../../common/numbers'
import { ZERO_ADDRESS } from '../../../../common/constants'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  PRICE_TIMEOUT,
  ORACLE_ERROR,
  ORACLE_TIMEOUT,
  MAX_TRADE_VOL,
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
  ANKRETH,
  ANKRETH_OWNER,
  ETH_USD_PRICE_FEED,
} from './constants'
import { whileImpersonating } from '../../../utils/impersonation'

/*
  Define interfaces
*/

interface AnkrETHCollateralFixtureContext extends CollateralFixtureContext {
  ankreth: IAnkrETH
  targetPerTokChainlinkFeed: MockV3Aggregator
}

interface AnkrETHCollateralOpts extends CollateralOpts {
  targetPerTokChainlinkFeed?: string
  targetPerTokChainlinkTimeout?: BigNumberish
}

/*
  Define deployment functions
*/

export const defaultAnkrETHCollateralOpts: AnkrETHCollateralOpts = {
  erc20: ANKRETH,
  targetName: ethers.utils.formatBytes32String('ETH'),
  rewardERC20: ZERO_ADDRESS,
  priceTimeout: PRICE_TIMEOUT,
  chainlinkFeed: ETH_USD_PRICE_FEED,
  oracleTimeout: ORACLE_TIMEOUT,
  oracleError: ORACLE_ERROR,
  maxTradeVolume: MAX_TRADE_VOL,
  defaultThreshold: DEFAULT_THRESHOLD,
  delayUntilDefault: DELAY_UNTIL_DEFAULT,
  revenueHiding: fp('0'),
}

export const deployCollateral = async (
  opts: AnkrETHCollateralOpts = {}
): Promise<TestICollateral> => {
  opts = { ...defaultAnkrETHCollateralOpts, ...opts }

  if (opts.targetPerTokChainlinkFeed === undefined) {
    // Use mock targetPerTok feed until Chainlink deploys a real one
    const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
      await ethers.getContractFactory('MockV3Aggregator')
    )
    const targetPerTokChainlinkFeed = <MockV3Aggregator>(
      await MockV3AggregatorFactory.deploy(18, targetPerTokChainlinkDefaultAnswer)
    )
    opts.targetPerTokChainlinkFeed = targetPerTokChainlinkFeed.address
  }
  if (opts.targetPerTokChainlinkTimeout === undefined) {
    opts.targetPerTokChainlinkTimeout = ORACLE_TIMEOUT
  }

  const AnkrETHCollateralFactory: ContractFactory = await ethers.getContractFactory(
    'AnkrStakedEthCollateral'
  )

  const collateral = <TestICollateral>await AnkrETHCollateralFactory.deploy(
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
    opts.targetPerTokChainlinkFeed,
    opts.targetPerTokChainlinkTimeout,
    { gasLimit: 2000000000 }
  )
  await collateral.deployed()

  // Push forward chainlink feed
  await pushOracleForward(opts.chainlinkFeed!)

  // sometimes we are trying to test a negative test case and we want this to fail silently
  // fortunately this syntax fails silently because our tools are terrible
  await expect(collateral.refresh())

  return collateral
}

const chainlinkDefaultAnswer = bn('1600e8')
const targetPerTokChainlinkDefaultAnswer = fp('1.075118097902877192') // TODO

type Fixture<T> = () => Promise<T>

const makeCollateralFixtureContext = (
  alice: SignerWithAddress,
  opts: AnkrETHCollateralOpts = {}
): Fixture<AnkrETHCollateralFixtureContext> => {
  const collateralOpts = { ...defaultAnkrETHCollateralOpts, ...opts }

  const makeCollateralFixtureContext = async () => {
    const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
      await ethers.getContractFactory('MockV3Aggregator')
    )

    const chainlinkFeed = <MockV3Aggregator>(
      await MockV3AggregatorFactory.deploy(8, chainlinkDefaultAnswer)
    )

    collateralOpts.chainlinkFeed = chainlinkFeed.address

    const targetPerTokChainlinkFeed = <MockV3Aggregator>(
      await MockV3AggregatorFactory.deploy(18, targetPerTokChainlinkDefaultAnswer)
    )
    collateralOpts.targetPerTokChainlinkFeed = targetPerTokChainlinkFeed.address
    collateralOpts.targetPerTokChainlinkTimeout = ORACLE_TIMEOUT

    const ankreth = (await ethers.getContractAt('IAnkrETH', ANKRETH)) as IAnkrETH
    const collateral = await deployCollateral(collateralOpts)

    return {
      alice,
      collateral,
      chainlinkFeed,
      targetPerTokChainlinkFeed,
      ankreth,
      tok: ankreth,
    }
  }

  return makeCollateralFixtureContext
}

/*
  Define helper functions
*/

const mintCollateralTo: MintCollateralFunc<AnkrETHCollateralFixtureContext> = async (
  ctx: AnkrETHCollateralFixtureContext,
  amount: BigNumberish,
  user: SignerWithAddress,
  recipient: string
) => {
  await mintAnkrETH(ctx.ankreth, user, amount, recipient)
}

const changeTargetPerRef = async (
  ctx: AnkrETHCollateralFixtureContext,
  percentChange: BigNumber
) => {
  // We leave the actual refPerTok exchange where it is and just change {target/tok}
  {
    const lastRound = await ctx.targetPerTokChainlinkFeed.latestRoundData()
    const nextAnswer = lastRound.answer.add(lastRound.answer.mul(percentChange).div(100))
    await ctx.targetPerTokChainlinkFeed.updateAnswer(nextAnswer)
  }
}

const reduceTargetPerRef = async (
  ctx: AnkrETHCollateralFixtureContext,
  pctDecrease: BigNumberish
) => {
  await changeTargetPerRef(ctx, bn(pctDecrease).mul(-1))
}

const increaseTargetPerRef = async (
  ctx: AnkrETHCollateralFixtureContext,
  pctIncrease: BigNumberish
) => {
  await changeTargetPerRef(ctx, bn(pctIncrease))
}

const changeRefPerTok = async (ctx: AnkrETHCollateralFixtureContext, percentChange: BigNumber) => {
  const ankrETH = (await ethers.getContractAt('IAnkrETH', ANKRETH)) as IAnkrETH

  // Move ratio in opposite direction as percentChange
  const currentRatio = await ankrETH.ratio()
  const newRatio: BigNumberish = currentRatio.add(currentRatio.mul(percentChange.mul(-1)).div(100))

  // Impersonate AnkrETH Owner
  await whileImpersonating(ANKRETH_OWNER, async (ankrEthOwnerSigner) => {
    await ankrETH.connect(ankrEthOwnerSigner).updateRatio(newRatio)
  })

  {
    const lastRound = await ctx.targetPerTokChainlinkFeed.latestRoundData()
    const nextAnswer = lastRound.answer.add(lastRound.answer.mul(percentChange).div(100))
    await ctx.targetPerTokChainlinkFeed.updateAnswer(nextAnswer)
  }

  {
    const lastRound = await ctx.chainlinkFeed.latestRoundData()
    const nextAnswer = lastRound.answer.add(lastRound.answer.mul(percentChange).div(100))
    await ctx.chainlinkFeed.updateAnswer(nextAnswer)
  }
}

const reduceRefPerTok = async (ctx: AnkrETHCollateralFixtureContext, pctDecrease: BigNumberish) => {
  await changeRefPerTok(ctx, bn(pctDecrease).mul(-1))
}

const increaseRefPerTok = async (
  ctx: AnkrETHCollateralFixtureContext,
  pctIncrease: BigNumberish
) => {
  await changeRefPerTok(ctx, bn(pctIncrease))
}

const getExpectedPrice = async (ctx: AnkrETHCollateralFixtureContext): Promise<BigNumber> => {
  const clData = await ctx.chainlinkFeed.latestRoundData()
  const clDecimals = await ctx.chainlinkFeed.decimals()

  const clRptData = await ctx.targetPerTokChainlinkFeed.latestRoundData()
  const clRptDecimals = await ctx.targetPerTokChainlinkFeed.decimals()

  return clData.answer
    .mul(bn(10).pow(18 - clDecimals))
    .mul(clRptData.answer.mul(bn(10).pow(18 - clRptDecimals)))
    .div(fp('1'))
}

/*
  Define collateral-specific tests
*/

// eslint-disable-next-line @typescript-eslint/no-empty-function
const collateralSpecificConstructorTests = () => {
  it('does not allow missing targetPerTok chainlink feed', async () => {
    await expect(
      deployCollateral({ targetPerTokChainlinkFeed: ethers.constants.AddressZero })
    ).to.be.revertedWith('missing targetPerTok feed')
  })

  it('does not allow targetPerTok oracle timeout at 0', async () => {
    await expect(deployCollateral({ targetPerTokChainlinkTimeout: 0 })).to.be.revertedWith(
      'targetPerTokChainlinkTimeout zero'
    )
  })
}

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
  itHasRevenueHiding: it,
  itChecksNonZeroDefaultThreshold: it,
  resetFork,
  collateralName: 'AnkrStakedETH',
  chainlinkDefaultAnswer,
  itIsPricedByPeg: true,
}

collateralTests(opts)
