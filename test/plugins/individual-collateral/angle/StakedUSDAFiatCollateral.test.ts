import collateralTests from '../collateralTests'
import { CollateralFixtureContext, CollateralOpts, MintCollateralFunc } from '../pluginTestTypes'
import { mintStUSD, mintUSDA } from './helpers'
import { ethers } from 'hardhat'
import { expect } from 'chai'
import { ContractFactory, BigNumberish, BigNumber } from 'ethers'
import {
  ERC20Mock,
  IERC20Metadata,
  MockV3Aggregator,
  MockV3Aggregator__factory,
  TestICollateral,
} from '../../../../typechain'
import { pushOracleForward } from '../../../utils/oracles'
import { bn, fp } from '../../../../common/numbers'

import { ONE_ADDRESS, ZERO_ADDRESS } from '../../../../common/constants'
import { whileImpersonating } from '../../../utils/impersonation'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  USDA,
  StUSD,
  USDA_USD_PRICE_FEED,
  ORACLE_ERROR,
  ORACLE_TIMEOUT,
  PRICE_TIMEOUT,
  MAX_TRADE_VOL,
  DELAY_UNTIL_DEFAULT,
  DEFAULT_THRESHOLD,
  FORK_BLOCK,
  REVENUE_HIDING,
} from './constants'
import { getResetFork } from '../helpers'

/*
  Define deployment functions
*/

export const defaultUSDACollateralOpts: CollateralOpts = {
  erc20: StUSD,
  targetName: ethers.utils.formatBytes32String('USD'),
  rewardERC20: ZERO_ADDRESS,
  priceTimeout: PRICE_TIMEOUT,
  chainlinkFeed: USDA_USD_PRICE_FEED,
  oracleTimeout: ORACLE_TIMEOUT,
  oracleError: ORACLE_ERROR,
  maxTradeVolume: MAX_TRADE_VOL,
  defaultThreshold: DEFAULT_THRESHOLD, // 72 hs
  delayUntilDefault: DELAY_UNTIL_DEFAULT,
  revenueHiding: REVENUE_HIDING,
}

export const deployCollateral = async (opts: CollateralOpts = {}): Promise<TestICollateral> => {
  opts = { ...defaultUSDACollateralOpts, ...opts }

  const StakedUSDAFiatCollateralFactory: ContractFactory = await ethers.getContractFactory(
    'StakedUSDAFiatCollateral'
  )
  const collateral = <TestICollateral>await StakedUSDAFiatCollateralFactory.deploy(
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

  // Push forward feed
  await pushOracleForward(opts.chainlinkFeed!)

  // sometimes we are trying to test a negative test case and we want this to fail silently
  // fortunately this syntax fails silently because our tools are terrible
  await expect(collateral.refresh())

  return collateral
}

const chainlinkDefaultAnswer = bn('1e8')

type Fixture<T> = () => Promise<T>

const makeCollateralFixtureContext = (
  alice: SignerWithAddress,
  opts: CollateralOpts = {}
): Fixture<CollateralFixtureContext> => {
  const collateralOpts = { ...defaultUSDACollateralOpts, ...opts }

  const makeCollateralFixtureContext = async () => {
    const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
      await ethers.getContractFactory('MockV3Aggregator')
    )

    const chainlinkFeed = <MockV3Aggregator>(
      await MockV3AggregatorFactory.deploy(8, chainlinkDefaultAnswer)
    )
    collateralOpts.chainlinkFeed = chainlinkFeed.address

    const stUSD = (await ethers.getContractAt('IERC20Metadata', StUSD)) as IERC20Metadata
    const rewardToken = (await ethers.getContractAt('ERC20Mock', ZERO_ADDRESS)) as ERC20Mock
    const collateral = await deployCollateral(collateralOpts)
    const tok = await ethers.getContractAt('IERC20Metadata', await collateral.erc20())

    return {
      alice,
      collateral,
      chainlinkFeed,
      tok,
      stUSD,
      rewardToken,
    }
  }

  return makeCollateralFixtureContext
}

const mintCollateralTo: MintCollateralFunc<CollateralFixtureContext> = async (
  ctx: CollateralFixtureContext,
  amount: BigNumberish,
  user: SignerWithAddress,
  recipient: string
) => {
  await mintStUSD(ctx.tok, user, amount, recipient)
}

const reduceTargetPerRef = async (ctx: CollateralFixtureContext, pctDecrease: BigNumberish) => {
  const lastRound = await ctx.chainlinkFeed.latestRoundData()
  const nextAnswer = lastRound.answer.sub(lastRound.answer.mul(pctDecrease).div(100))
  await ctx.chainlinkFeed.updateAnswer(nextAnswer)
}

const increaseTargetPerRef = async (ctx: CollateralFixtureContext, pctIncrease: BigNumberish) => {
  const lastRound = await ctx.chainlinkFeed.latestRoundData()
  const nextAnswer = lastRound.answer.add(lastRound.answer.mul(pctIncrease).div(100))
  await ctx.chainlinkFeed.updateAnswer(nextAnswer)
}

// prettier-ignore
const reduceRefPerTok = async (
  ctx: CollateralFixtureContext,
  pctDecrease: BigNumberish
) => {
  const usda = <IERC20Metadata>await ethers.getContractAt("IERC20Metadata", USDA)
  const currentBal = await usda.balanceOf(ctx.tok.address)
  const removeBal = currentBal.mul(pctDecrease).div(100)
  await whileImpersonating(ctx.tok.address, async (stUSDSigner) => {
    await usda.connect(stUSDSigner).transfer(ONE_ADDRESS, removeBal)
  })
}

// prettier-ignore
const increaseRefPerTok = async (
  ctx: CollateralFixtureContext,
  pctIncrease: BigNumberish
) => {
  const usda = <IERC20Metadata>await ethers.getContractAt("IERC20Metadata", USDA)
  const currentBal = await usda.balanceOf(ctx.tok.address)
  const addBal = currentBal.mul(pctIncrease).div(100)
  await mintUSDA(usda, ctx.alice!, addBal, ctx.tok.address)
}

// Calculate the expected price based on the StakedUSDAFiatCollateral's tryPrice() implementation (inherited from AppreciatingFiatCollateral)
const getExpectedPrice = async (ctx: CollateralFixtureContext): Promise<BigNumber> => {
  const clData = await ctx.chainlinkFeed.latestRoundData()
  const clDecimals = await ctx.chainlinkFeed.decimals()

  const underlyingRefPerTok = await ctx.collateral.underlyingRefPerTok()
  return clData.answer
    .mul(bn(10).pow(18 - clDecimals))
    .mul(underlyingRefPerTok)
    .div(fp('1'))
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
  itChecksNonZeroDefaultThreshold: it,
  itHasRevenueHiding: it,
  collateralName: 'Staked USDA (stUSD) Fiat Collateral',
  chainlinkDefaultAnswer,
  itIsPricedByPeg: true,
  resetFork: getResetFork(FORK_BLOCK),
}

collateralTests(opts)
