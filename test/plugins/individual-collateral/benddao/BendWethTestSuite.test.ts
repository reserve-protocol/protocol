import collateralTests from '../collateralTests'
import { CollateralFixtureContext, CollateralOpts, MintCollateralFunc } from '../pluginTestTypes'
import { makeStaticBendWeth, mintStaticBendWeth, resetFork } from './helpers'
import { ethers } from 'hardhat'
import { expect } from 'chai'
import { ContractFactory, BigNumberish, BigNumber } from 'ethers'
import {
  BEND,
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
  ETH_USD_PRICE_FEED,
  MAX_TRADE_VOL,
  ORACLE_ERROR,
  ORACLE_TIMEOUT,
  PRICE_TIMEOUT,
  REVENUE_HIDING,
  WETH,
} from './constants'
import {
  ERC20Mock,
  IStaticBToken,
  IStaticBTokenLM,
  MockV3Aggregator,
  MockV3Aggregator__factory,
  TestICollateral,
  WETH9,
} from '../../../../typechain'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { bn, fp } from '../../../../common/numbers'

interface BendCollateralFixtureContext extends CollateralFixtureContext {
  weth: WETH9
  staticBendWeth: IStaticBTokenLM
  tok: IStaticBToken
}

export const defaultBendWethCollateralOpts: CollateralOpts = {
  erc20: WETH,
  targetName: ethers.utils.formatBytes32String('ETH'),
  rewardERC20: BEND,
  priceTimeout: PRICE_TIMEOUT,
  chainlinkFeed: ETH_USD_PRICE_FEED,
  oracleError: ORACLE_ERROR,
  oracleTimeout: ORACLE_TIMEOUT,
  maxTradeVolume: MAX_TRADE_VOL,
  defaultThreshold: DEFAULT_THRESHOLD,
  delayUntilDefault: DELAY_UNTIL_DEFAULT,
  revenueHiding: REVENUE_HIDING,
}

export const deployCollateral = async (opts: CollateralOpts = {}): Promise<TestICollateral> => {
  opts = { ...defaultBendWethCollateralOpts, ...opts }
  const BendWethCollateralFactory: ContractFactory = await ethers.getContractFactory(
    'BendWethCollateral'
  )
  const collateral = <TestICollateral>await BendWethCollateralFactory.deploy(
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
    { gasLimit: 2000000000 }
  )
  await collateral.deployed()

  // sometimes we are trying to test a negative test case and we want this to fail silently
  // fortunately this syntax fails silently because our tools are terrible
  await expect(collateral.refresh())

  return collateral
}

const chainlinkDefaultAnswer = bn('1600e8')
type Fixture<T> = () => Promise<T>

const makeCollateralFixtureContext = (
  alice: SignerWithAddress,
  opts: CollateralOpts = {}
): Fixture<BendCollateralFixtureContext> => {
  const collateralOpts = { ...defaultBendWethCollateralOpts, ...opts }

  const makeCollateralFixtureContext = async () => {
    const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
      await ethers.getContractFactory('MockV3Aggregator')
    )

    const chainlinkFeed = <MockV3Aggregator>(
      await MockV3AggregatorFactory.deploy(8, chainlinkDefaultAnswer)
    )

    const { tok, staticBendWeth, weth } = await makeStaticBendWeth()
    const rewardToken = (await ethers.getContractAt('ERC20Mock', BEND)) as ERC20Mock

    collateralOpts.chainlinkFeed = chainlinkFeed.address
    collateralOpts.erc20 = tok.address
    const collateral = await deployCollateral(collateralOpts)

    return {
      alice,
      collateral,
      chainlinkFeed,
      weth,
      staticBendWeth,
      tok: tok,
      rewardToken,
    }
  }

  return makeCollateralFixtureContext
}

const mintCollateralTo: MintCollateralFunc<BendCollateralFixtureContext> = async (
  ctx: BendCollateralFixtureContext,
  amount: BigNumberish,
  user: SignerWithAddress,
  recipient: string
) => {
  await mintStaticBendWeth(ctx.weth, ctx.staticBendWeth, user, amount, recipient)
}

const increaseRefPerTok = async (ctx: BendCollateralFixtureContext, pctIncrease: BigNumberish) => {
  // TODO
  // get current normalized income
  // estimate how long it would take to reach pctIncrease
  // forward time
}

// eslint-disable-next-line @typescript-eslint/no-empty-function
const getExpectedPrice = async (ctx: BendCollateralFixtureContext): Promise<BigNumber> => {
  const roundData = await ctx.chainlinkFeed.latestRoundData()
  const decimals = await ctx.chainlinkFeed.decimals()
  const refPerTok = await ctx.collateral.refPerTok()

  return roundData.answer
    .mul(bn(10).pow(18 - decimals))
    .mul(refPerTok)
    .div(fp('1'))
}

// eslint-disable-next-line @typescript-eslint/no-empty-function
const reduceTargetPerRef = async () => {}

// eslint-disable-next-line @typescript-eslint/no-empty-function
const increaseTargetPerRef = async () => {}

// eslint-disable-next-line @typescript-eslint/no-empty-function
const reduceRefPerTok = async () => {}

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
  itClaimsRewards: it,
  itChecksPriceChanges: it,

  // targetPerRef is always 1
  // refPerTok doesn't decrease
  itChecksTargetPerRefDefault: it.skip,
  itChecksRefPerTokDefault: it.skip,
  itHasRevenueHiding: it.skip,

  // set to false cause targetPerRef doesn't change (it's always 1)
  // therefore, prices do not change as targetPerRef changes
  itIsPricedByPeg: false,

  resetFork,
  collateralName: 'BendWETH',
  chainlinkDefaultAnswer,
}

collateralTests(opts)
