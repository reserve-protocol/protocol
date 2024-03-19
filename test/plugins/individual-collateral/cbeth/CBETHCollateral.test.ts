import collateralTests from '../collateralTests'
import { CollateralFixtureContext, CollateralOpts, MintCollateralFunc } from '../pluginTestTypes'
import {
  CBETH_ETH_PRICE_FEED,
  CB_ETH,
  CB_ETH_ORACLE,
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
  ETH_USD_PRICE_FEED,
  MAX_TRADE_VOL,
  ORACLE_ERROR,
  ORACLE_TIMEOUT,
  PRICE_TIMEOUT,
} from './constants'
import { pushOracleForward } from '../../../utils/oracles'
import { BigNumber, BigNumberish, ContractFactory } from 'ethers'
import { bn, fp } from '#/common/numbers'
import { TestICollateral } from '@typechain/TestICollateral'
import { ethers } from 'hardhat'
import { expect } from 'chai'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { MockV3Aggregator } from '@typechain/MockV3Aggregator'
import { ICBEth, ERC20Mock, MockV3Aggregator__factory } from '@typechain/index'
import { mintCBETH, resetFork } from './helpers'
import { whileImpersonating } from '#/utils/impersonation'
import hre from 'hardhat'

interface CbEthCollateralFixtureContext extends CollateralFixtureContext {
  cbETH: ICBEth
  targetPerTokChainlinkFeed: MockV3Aggregator
}

interface CbEthCollateralOpts extends CollateralOpts {
  targetPerTokChainlinkFeed?: string
  targetPerTokChainlinkTimeout?: BigNumberish
}

export const deployCollateral = async (
  opts: CbEthCollateralOpts = {}
): Promise<TestICollateral> => {
  opts = { ...defaultCBEthCollateralOpts, ...opts }

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
    opts.targetPerTokChainlinkFeed ?? CBETH_ETH_PRICE_FEED,
    opts.targetPerTokChainlinkTimeout ?? ORACLE_TIMEOUT,
    { gasLimit: 2000000000 }
  )
  await collateral.deployed()

  // Push forward chainlink feeds
  await pushOracleForward(opts.chainlinkFeed!)
  await pushOracleForward(opts.targetPerTokChainlinkFeed ?? CBETH_ETH_PRICE_FEED)

  await expect(collateral.refresh())

  return collateral
}

const chainlinkDefaultAnswer = bn('1600e8')
const targetPerTokChainlinkDefaultAnswer = fp('1.04027709')

type Fixture<T> = () => Promise<T>

const makeCollateralFixtureContext = (
  alice: SignerWithAddress,
  opts: CbEthCollateralOpts = {}
): Fixture<CbEthCollateralFixtureContext> => {
  const collateralOpts = { ...defaultCBEthCollateralOpts, ...opts }

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

    const cbETH = (await ethers.getContractAt('ICBEth', CB_ETH)) as unknown as ICBEth
    const collateral = await deployCollateral(collateralOpts)

    return {
      alice,
      collateral,
      chainlinkFeed,
      targetPerTokChainlinkFeed,
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

const changeTargetPerRef = async (ctx: CbEthCollateralFixtureContext, percentChange: BigNumber) => {
  // We leave the actual refPerTok exchange where it is and just change {target/tok}
  {
    const lastRound = await ctx.targetPerTokChainlinkFeed.latestRoundData()
    const nextAnswer = lastRound.answer.add(lastRound.answer.mul(percentChange).div(100))
    await ctx.targetPerTokChainlinkFeed.updateAnswer(nextAnswer)
  }
}

const reduceTargetPerRef = async (
  ctx: CbEthCollateralFixtureContext,
  pctDecrease: BigNumberish
) => {
  await changeTargetPerRef(ctx, bn(pctDecrease).mul(-1))
}

const increaseTargetPerRef = async (
  ctx: CbEthCollateralFixtureContext,
  pctDecrease: BigNumberish
) => {
  await changeTargetPerRef(ctx, bn(pctDecrease))
}

const changeRefPerTok = async (ctx: CbEthCollateralFixtureContext, percentChange: BigNumber) => {
  await whileImpersonating(hre, CB_ETH_ORACLE, async (oracleSigner) => {
    const rate = await ctx.cbETH.exchangeRate()
    await ctx.cbETH
      .connect(oracleSigner)
      .updateExchangeRate(rate.add(rate.mul(percentChange).div(bn('100'))))
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
  })
}

const reduceRefPerTok = async (ctx: CbEthCollateralFixtureContext, pctDecrease: BigNumberish) => {
  await changeRefPerTok(ctx, bn(pctDecrease).mul(-1))
}

const increaseRefPerTok = async (ctx: CbEthCollateralFixtureContext, pctIncrease: BigNumberish) => {
  await changeRefPerTok(ctx, bn(pctIncrease))
}
const getExpectedPrice = async (ctx: CbEthCollateralFixtureContext): Promise<BigNumber> => {
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

export const defaultCBEthCollateralOpts: CollateralOpts = {
  erc20: CB_ETH,
  targetName: ethers.utils.formatBytes32String('ETH'),
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
  itChecksTargetPerRefDefault: it,
  itChecksTargetPerRefDefaultUp: it,
  itChecksRefPerTokDefault: it,
  itChecksPriceChanges: it,
  itHasRevenueHiding: it,
  itChecksNonZeroDefaultThreshold: it,
  resetFork,
  collateralName: 'CBEthCollateral',
  chainlinkDefaultAnswer,
  itIsPricedByPeg: true,
}

collateralTests(opts)
