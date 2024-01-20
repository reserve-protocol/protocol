import collateralTests from '../collateralTests'
import { CollateralFixtureContext, CollateralOpts, MintCollateralFunc } from '../pluginTestTypes'
import {
  CBETH_ETH_PRICE_FEED_BASE,
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
  MAX_TRADE_VOL,
  ORACLE_ERROR,
  ORACLE_TIMEOUT,
  PRICE_TIMEOUT,
  CBETH_ETH_EXCHANGE_RATE_FEED_BASE,
  FORK_BLOCK_BASE,
  CB_ETH_BASE,
  ETH_USD_PRICE_FEED_BASE,
} from './constants'
import { BigNumber, BigNumberish, ContractFactory } from 'ethers'
import { bn, fp } from '#/common/numbers'
import { TestICollateral } from '@typechain/TestICollateral'
import { ethers } from 'hardhat'
import { expect } from 'chai'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { MockV3Aggregator } from '@typechain/MockV3Aggregator'
import { ICBEth, CBEthCollateralL2, ERC20Mock, MockV3Aggregator__factory } from '@typechain/index'
import { mintCBETHBase } from './helpers'
import { pushOracleForward } from '../../../utils/oracles'
import { getResetFork } from '../helpers'

interface CbEthCollateralL2FixtureContext extends CollateralFixtureContext {
  cbETH: ICBEth
  targetPerTokChainlinkFeed: MockV3Aggregator
  exchangeRateChainlinkFeed: MockV3Aggregator
}

interface CbEthCollateralL2Opts extends CollateralOpts {
  targetPerTokChainlinkFeed?: string
  targetPerTokChainlinkTimeout?: BigNumberish
  exchangeRateChainlinkFeed?: string
  exchangeRateChainlinkTimeout?: BigNumberish
}

export const deployCollateral = async (
  opts: CbEthCollateralL2Opts = {}
): Promise<TestICollateral> => {
  opts = { ...defaultCBEthCollateralL2Opts, ...opts }

  const CBETHCollateralFactory: ContractFactory = await ethers.getContractFactory(
    'CBEthCollateralL2'
  )

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
    opts.targetPerTokChainlinkFeed ?? CBETH_ETH_PRICE_FEED_BASE,
    opts.targetPerTokChainlinkTimeout ?? ORACLE_TIMEOUT,
    opts.exchangeRateChainlinkFeed ?? CBETH_ETH_EXCHANGE_RATE_FEED_BASE,
    opts.exchangeRateChainlinkTimeout ?? ORACLE_TIMEOUT,
    { gasLimit: 2000000000 }
  )
  await collateral.deployed()

  await pushOracleForward(opts.chainlinkFeed!)
  await pushOracleForward(opts.targetPerTokChainlinkFeed ?? CBETH_ETH_PRICE_FEED_BASE)
  await pushOracleForward(opts.exchangeRateChainlinkFeed ?? CBETH_ETH_EXCHANGE_RATE_FEED_BASE)

  await expect(collateral.refresh())

  return collateral
}

const chainlinkDefaultAnswer = bn('1600e8')
const targetPerTokChainlinkDefaultAnswer = bn('1e18')
const exchangeRateChainlinkFeedDefaultAnswer = bn('1e18')

type Fixture<T> = () => Promise<T>

const makeCollateralFixtureContext = (
  alice: SignerWithAddress,
  opts: CbEthCollateralL2Opts = {}
): Fixture<CbEthCollateralL2FixtureContext> => {
  const collateralOpts = { ...defaultCBEthCollateralL2Opts, ...opts }

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

    const exchangeRateChainlinkFeed = <MockV3Aggregator>(
      await MockV3AggregatorFactory.deploy(18, exchangeRateChainlinkFeedDefaultAnswer)
    )
    collateralOpts.exchangeRateChainlinkFeed = exchangeRateChainlinkFeed.address
    collateralOpts.exchangeRateChainlinkTimeout = ORACLE_TIMEOUT

    const cbETH = (await ethers.getContractAt('ICBEth', CB_ETH_BASE)) as unknown as ICBEth
    const collateral = await deployCollateral(collateralOpts)

    return {
      alice,
      collateral,
      chainlinkFeed,
      targetPerTokChainlinkFeed,
      exchangeRateChainlinkFeed,
      cbETH,
      tok: cbETH as unknown as ERC20Mock,
    }
  }

  return makeCollateralFixtureContext
}
/*
  Define helper functions
*/

const mintCollateralTo: MintCollateralFunc<CbEthCollateralL2FixtureContext> = async (
  ctx: CbEthCollateralL2FixtureContext,
  amount: BigNumberish,
  user: SignerWithAddress,
  recipient: string
) => {
  await mintCBETHBase(amount, recipient)
}

const changeTargetPerRef = async (
  ctx: CbEthCollateralL2FixtureContext,
  percentChange: BigNumber
) => {
  const lastRound = await ctx.targetPerTokChainlinkFeed.latestRoundData()
  const nextAnswer = lastRound.answer.add(lastRound.answer.mul(percentChange).div(100))
  await ctx.targetPerTokChainlinkFeed.updateAnswer(nextAnswer)
}

const reduceTargetPerRef = async (
  ctx: CbEthCollateralL2FixtureContext,
  pctDecrease: BigNumberish
) => {
  await changeTargetPerRef(ctx, bn(pctDecrease).mul(-1))
}

const increaseTargetPerRef = async (
  ctx: CbEthCollateralL2FixtureContext,
  pctDecrease: BigNumberish
) => {
  await changeTargetPerRef(ctx, bn(pctDecrease))
}

const changeRefPerTok = async (ctx: CbEthCollateralL2FixtureContext, percentChange: BigNumber) => {
  const collateral = ctx.collateral as unknown as CBEthCollateralL2
  const exchangeRateOracle = await ethers.getContractAt(
    'MockV3Aggregator',
    await collateral.exchangeRateChainlinkFeed()
  )
  const lastRound = await exchangeRateOracle.latestRoundData()
  const nextAnswer = lastRound.answer.add(lastRound.answer.mul(percentChange).div(100))
  await exchangeRateOracle.updateAnswer(nextAnswer)

  const targetPerTokOracle = await ethers.getContractAt(
    'MockV3Aggregator',
    await collateral.targetPerTokChainlinkFeed()
  )
  const lastRoundtpt = await targetPerTokOracle.latestRoundData()
  const nextAnswertpt = lastRoundtpt.answer.add(lastRoundtpt.answer.mul(percentChange).div(100))
  await targetPerTokOracle.updateAnswer(nextAnswertpt)
}

const reduceRefPerTok = async (ctx: CbEthCollateralL2FixtureContext, pctDecrease: BigNumberish) => {
  await changeRefPerTok(ctx, bn(pctDecrease).mul(-1))
}

const increaseRefPerTok = async (
  ctx: CbEthCollateralL2FixtureContext,
  pctIncrease: BigNumberish
) => {
  await changeRefPerTok(ctx, bn(pctIncrease))
}
const getExpectedPrice = async (ctx: CbEthCollateralL2FixtureContext): Promise<BigNumber> => {
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

  it('does not allow missing exchangeRate chainlink feed', async () => {
    await expect(
      deployCollateral({ exchangeRateChainlinkFeed: ethers.constants.AddressZero })
    ).to.be.revertedWith('missing exchangeRate feed')
  })

  it('does not allow exchangeRate oracle timeout at 0', async () => {
    await expect(deployCollateral({ exchangeRateChainlinkTimeout: 0 })).to.be.revertedWith(
      'exchangeRateChainlinkTimeout zero'
    )
  })
}

// eslint-disable-next-line @typescript-eslint/no-empty-function
const collateralSpecificStatusTests = () => {}
// eslint-disable-next-line @typescript-eslint/no-empty-function
const beforeEachRewardsTest = async () => {}

export const defaultCBEthCollateralL2Opts: CollateralOpts = {
  erc20: CB_ETH_BASE,
  targetName: ethers.utils.formatBytes32String('ETH'),
  priceTimeout: PRICE_TIMEOUT,
  chainlinkFeed: ETH_USD_PRICE_FEED_BASE,
  oracleTimeout: ORACLE_TIMEOUT,
  oracleError: ORACLE_ERROR,
  maxTradeVolume: MAX_TRADE_VOL,
  defaultThreshold: DEFAULT_THRESHOLD,
  delayUntilDefault: DELAY_UNTIL_DEFAULT,
  revenueHiding: fp('0'),
}

export const resetFork = getResetFork(FORK_BLOCK_BASE)

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
  collateralName: 'CBEthCollateralL2',
  chainlinkDefaultAnswer,
  itIsPricedByPeg: true,
  targetNetwork: 'base',
}

collateralTests(opts)
