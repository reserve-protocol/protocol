import collateralTests from '../collateralTests'
import { CollateralFixtureContext, CollateralOpts, MintCollateralFunc } from '../pluginTestTypes'
import {
  CB_ETH,
  CB_ETH_ORACLE,
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
  ETH_USD_PRICE_FEED,
  MAX_TRADE_VOL,
  ORACLE_ERROR,
  ORACLE_TIMEOUT,
  PRICE_TIMEOUT,
  WETH,
} from './constants'
import { BigNumber, BigNumberish, ContractFactory } from 'ethers'
import { bn, fp } from '#/common/numbers'
import { TestICollateral } from '@typechain/TestICollateral'
import { ethers } from 'hardhat'
import { expect } from 'chai'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { MockV3Aggregator } from '@typechain/MockV3Aggregator'
import { CBEth, ERC20Mock, MockV3Aggregator__factory } from '@typechain/index'
import { mintCBETH, resetFork } from './helpers'
import { whileImpersonating } from '#/utils/impersonation'
import hre from 'hardhat'

interface CbEthCollateralFixtureContext extends CollateralFixtureContext {
  cbETH: CBEth
  refPerTokChainlinkFeed: MockV3Aggregator
}

interface CbEthCollateralOpts extends CollateralOpts {
  refPerTokChainlinkFeed?: string
  refPerTokChainlinkTimeout?: BigNumberish
}

export const deployCollateral = async (
  opts: CbEthCollateralOpts = {}
): Promise<TestICollateral> => {
  opts = { ...defaultRethCollateralOpts, ...opts }

  const CBETHCollateralFactory: ContractFactory = await ethers.getContractFactory('CBEthCollateral')

  const collateral = <TestICollateral>await CBETHCollateralFactory.deploy(
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
    opts.refPerTokChainlinkFeed ?? ethers.constants.AddressZero,
    opts.refPerTokChainlinkTimeout ?? ethers.constants.Zero,
    { gasLimit: 2000000000 }
  )
  await collateral.deployed()

  await expect(collateral.refresh())

  return collateral
}

const chainlinkDefaultAnswer = bn('1600e8')
const refPerTokChainlinkDefaultAnswer = fp('1')

type Fixture<T> = () => Promise<T>

const makeCollateralFixtureContext = (
  alice: SignerWithAddress,
  opts: CbEthCollateralOpts = {}
): Fixture<CbEthCollateralFixtureContext> => {
  const collateralOpts = { ...defaultRethCollateralOpts, ...opts }

  const makeCollateralFixtureContext = async () => {
    const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
      await ethers.getContractFactory('MockV3Aggregator')
    )

    const chainlinkFeed = <MockV3Aggregator>(
      await MockV3AggregatorFactory.deploy(8, chainlinkDefaultAnswer)
    )
    collateralOpts.chainlinkFeed = chainlinkFeed.address
    const refPerTokChainlinkFeed = <MockV3Aggregator>(
      await MockV3AggregatorFactory.deploy(18, refPerTokChainlinkDefaultAnswer)
    )

    collateralOpts.refPerTokChainlinkFeed = refPerTokChainlinkFeed.address
    collateralOpts.refPerTokChainlinkTimeout = PRICE_TIMEOUT

    const cbETH = (await ethers.getContractAt('CBEth', CB_ETH)) as unknown as CBEth
    const collateral = await deployCollateral(collateralOpts)

    return {
      alice,
      collateral,
      chainlinkFeed,
      refPerTokChainlinkFeed,
      cbETH,
      tok: cbETH as unknown as ERC20Mock,
    }
  }

  return makeCollateralFixtureContext
}
/*
  Define helper functions
*/

const mintCollateralTo: MintCollateralFunc<CbEthCollateralFixtureContext> = async (
  ctx: CbEthCollateralFixtureContext,
  amount: BigNumberish,
  user: SignerWithAddress,
  recipient: string
) => {
  await mintCBETH(amount, recipient)
}

// eslint-disable-next-line @typescript-eslint/no-empty-function
const reduceTargetPerRef = async () => {}

// eslint-disable-next-line @typescript-eslint/no-empty-function
const increaseTargetPerRef = async () => {}

// prettier-ignore
const reduceRefPerTok = async (
  ctx: CbEthCollateralFixtureContext,
  pctDecrease: BigNumberish
) => {
  await whileImpersonating(hre, CB_ETH_ORACLE, async oracleSigner => {
    const rate = await ctx.cbETH.exchangeRate()
    await ctx.cbETH.connect(oracleSigner).updateExchangeRate(
      rate.sub(rate.mul(bn(pctDecrease)).div(bn('100')))
    )
  })
  const lastRound = await ctx.refPerTokChainlinkFeed.latestRoundData()
  const nextAnswer = lastRound.answer.sub(lastRound.answer.mul(pctDecrease).div(100))
  await ctx.refPerTokChainlinkFeed.updateAnswer(nextAnswer)
}

// prettier-ignore
const increaseRefPerTok = async (
  ctx: CbEthCollateralFixtureContext,
  pctIncrease: BigNumberish
) => {
  await whileImpersonating(hre, CB_ETH_ORACLE, async oracleSigner => {
    const rate = await ctx.cbETH.exchangeRate()
    await ctx.cbETH.connect(oracleSigner).updateExchangeRate(
      rate.add(rate.mul(bn(pctIncrease)).div(bn('100')))
    )
  })
  const lastRound = await ctx.refPerTokChainlinkFeed.latestRoundData()
  const nextAnswer = lastRound.answer.add(lastRound.answer.mul(pctIncrease).div(100))
  await ctx.refPerTokChainlinkFeed.updateAnswer(nextAnswer)
}
const getExpectedPrice = async (ctx: CbEthCollateralFixtureContext): Promise<BigNumber> => {
  const clData = await ctx.chainlinkFeed.latestRoundData()
  const clDecimals = await ctx.chainlinkFeed.decimals()

  const clRptData = await ctx.refPerTokChainlinkFeed.latestRoundData()
  const clRptDecimals = await ctx.refPerTokChainlinkFeed.decimals()

  return clData.answer
    .mul(bn(10).pow(18 - clDecimals))
    .mul(clRptData.answer.mul(bn(10).pow(18 - clRptDecimals)))
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

export const defaultRethCollateralOpts: CollateralOpts = {
  erc20: CB_ETH,
  targetName: ethers.utils.formatBytes32String('ETH'),
  rewardERC20: WETH,
  priceTimeout: PRICE_TIMEOUT,
  chainlinkFeed: ETH_USD_PRICE_FEED,
  oracleTimeout: ORACLE_TIMEOUT,
  oracleError: ORACLE_ERROR,
  maxTradeVolume: MAX_TRADE_VOL,
  defaultThreshold: DEFAULT_THRESHOLD,
  delayUntilDefault: DELAY_UNTIL_DEFAULT,
  revenueHiding: fp('0'),
}

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
  itChecksRefPerTokDefault: it.skip,
  itChecksPriceChanges: it,
  itHasRevenueHiding: it.skip, // implemnted in this file
  resetFork: resetFork,
  collateralName: 'CBEthCollateral',
  chainlinkDefaultAnswer,
}

collateralTests(opts)
