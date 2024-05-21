import collateralTests from '../collateralTests'
import { CollateralFixtureContext, CollateralOpts, MintCollateralFunc } from '../pluginTestTypes'
import { resetFork, mintWUSDM, mintUSDM } from './helpers'
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
  ARB_USDM,
  ARB_WUSDM,
  ARB_WUSDM_USD_PRICE_FEED,
  ORACLE_ERROR,
  ORACLE_TIMEOUT,
  PRICE_TIMEOUT,
  MAX_TRADE_VOL,
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
} from './constants'

/*
  Define deployment functions
*/

export const defaultUSDMCollateralOpts: CollateralOpts = {
  erc20: ARB_WUSDM,
  targetName: ethers.utils.formatBytes32String('USD'),
  rewardERC20: ZERO_ADDRESS,
  priceTimeout: PRICE_TIMEOUT,
  chainlinkFeed: ARB_WUSDM_USD_PRICE_FEED,
  oracleTimeout: ORACLE_TIMEOUT,
  oracleError: ORACLE_ERROR,
  maxTradeVolume: MAX_TRADE_VOL,
  defaultThreshold: DEFAULT_THRESHOLD,
  delayUntilDefault: DELAY_UNTIL_DEFAULT,
  revenueHiding: fp('0'),
}

export const deployCollateral = async (opts: CollateralOpts = {}): Promise<TestICollateral> => {
  opts = { ...defaultUSDMCollateralOpts, ...opts }

  const USDMCollateralFactory: ContractFactory = await ethers.getContractFactory('USDMCollateral')
  const collateral = <TestICollateral>await USDMCollateralFactory.deploy(
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

  // Push forward chainlink feed
  await pushOracleForward(opts.chainlinkFeed!)

  // sometimes we are trying to test a negative test case and we want this to fail silently
  // fortunately this syntax fails silently because our tools are terrible
  await expect(collateral.refresh())

  return collateral
}

const chainlinkDefaultAnswer = bn('1.03e8')

type Fixture<T> = () => Promise<T>

const makeCollateralFixtureContext = (
  alice: SignerWithAddress,
  opts: CollateralOpts = {}
): Fixture<CollateralFixtureContext> => {
  const collateralOpts = { ...defaultUSDMCollateralOpts, ...opts }

  const makeCollateralFixtureContext = async () => {
    const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
      await ethers.getContractFactory('MockV3Aggregator')
    )

    const chainlinkFeed = <MockV3Aggregator>(
      await MockV3AggregatorFactory.deploy(8, chainlinkDefaultAnswer)
    )
    collateralOpts.chainlinkFeed = chainlinkFeed.address

    const wusdm = (await ethers.getContractAt('IERC20Metadata', ARB_WUSDM)) as IERC20Metadata
    const rewardToken = (await ethers.getContractAt('ERC20Mock', ZERO_ADDRESS)) as ERC20Mock
    const collateral = await deployCollateral(collateralOpts)
    const tok = await ethers.getContractAt('IERC20Metadata', await collateral.erc20())

    return {
      alice,
      collateral,
      chainlinkFeed,
      tok,
      wusdm,
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
  await mintWUSDM(ctx.tok, user, amount, recipient)
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

  const usdm = <IERC20Metadata>await ethers.getContractAt("IERC20Metadata", ARB_USDM)
  const currentBal = await usdm.balanceOf(ctx.tok.address)
  const removeBal = currentBal.mul(pctDecrease).div(100)
  await whileImpersonating(ctx.tok.address, async (wusdmSigner) => {
    await usdm.connect(wusdmSigner).transfer(ONE_ADDRESS, removeBal)
  })

  // push chainlink oracle forward so that tryPrice() still works and keeps peg
  const latestRoundData = await ctx.chainlinkFeed.latestRoundData()
  const nextAnswer = latestRoundData.answer.sub(latestRoundData.answer.mul(pctDecrease).div(100))
  await ctx.chainlinkFeed.updateAnswer(nextAnswer)
}

// prettier-ignore
const increaseRefPerTok = async (
  ctx: CollateralFixtureContext,
  pctIncrease: BigNumberish

) => {

  const usdm = <IERC20Metadata>await ethers.getContractAt("IERC20Metadata", ARB_USDM)

  const currentBal = await usdm.balanceOf(ctx.tok.address)
  const addBal = currentBal.mul(pctIncrease).div(100)
  await mintUSDM(usdm, ctx.alice!, addBal, ctx.tok.address)

  // push chainlink oracle forward so that tryPrice() still works and keeps peg
  const latestRoundData = await ctx.chainlinkFeed.latestRoundData()
  const nextAnswer = latestRoundData.answer.add(latestRoundData.answer.mul(pctIncrease).div(100))
  await ctx.chainlinkFeed.updateAnswer(nextAnswer)
}

const getExpectedPrice = async (ctx: CollateralFixtureContext): Promise<BigNumber> => {
  const clData = await ctx.chainlinkFeed.latestRoundData()
  const clDecimals = await ctx.chainlinkFeed.decimals()

  const refPerTok = await ctx.collateral.refPerTok()
  return clData.answer.mul(bn(10).pow(18 - clDecimals))
  // .mul(refPerTok)
  // .div(fp('1'))
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
  itHasRevenueHiding: it.skip,
  collateralName: 'USDM Collateral',
  chainlinkDefaultAnswer,
  itIsPricedByPeg: true,
  resetFork,
  targetNetwork: 'arbitrum',
}

collateralTests(opts)
