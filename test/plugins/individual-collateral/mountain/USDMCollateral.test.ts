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
import { expectUnpriced, pushOracleForward } from '../../../utils/oracles'
import { bn, fp, toBNDecimals } from '../../../../common/numbers'
import {
  BN_SCALE_FACTOR,
  ONE_ADDRESS,
  ZERO_ADDRESS,
  CollateralStatus,
} from '../../../../common/constants'
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
  ARB_CHRONICLE_FEED_AUTH,
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

  // It might revert if using real Chronicle oracle and not whitelisted (skip refresh())
  try {
    // Push forward feed
    await pushOracleForward(opts.chainlinkFeed!)

    // sometimes we are trying to test a negative test case and we want this to fail silently
    // fortunately this syntax fails silently because our tools are terrible
    await expect(collateral.refresh())
  } catch {
    expect(await collateral.chainlinkFeed()).to.equal(ARB_WUSDM_USD_PRICE_FEED)
  }

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

  return clData.answer.mul(bn(10).pow(18 - clDecimals))
}

/*
  Define collateral-specific tests
*/

// eslint-disable-next-line @typescript-eslint/no-empty-function
const collateralSpecificConstructorTests = () => {}

// eslint-disable-next-line @typescript-eslint/no-empty-function
const collateralSpecificStatusTests = () => {
  it('does revenue hiding correctly', async () => {
    const [, alice] = await ethers.getSigners()
    const tempCtx = await makeCollateralFixtureContext(alice, {
      erc20: ARB_WUSDM,
      revenueHiding: fp('0.0101'),
    })()

    // Set correct price to maintain peg
    const newPrice = fp('1')
      .mul(await tempCtx.collateral.underlyingRefPerTok())
      .div(BN_SCALE_FACTOR)
    await tempCtx.chainlinkFeed.updateAnswer(toBNDecimals(newPrice, 8))
    await tempCtx.collateral.refresh()
    expect(await tempCtx.collateral.status()).to.equal(CollateralStatus.SOUND)

    // Should remain SOUND after a 1% decrease
    let refPerTok = await tempCtx.collateral.refPerTok()
    await reduceRefPerTok(tempCtx, 1)
    await tempCtx.collateral.refresh()
    expect(await tempCtx.collateral.status()).to.equal(CollateralStatus.SOUND)

    // refPerTok should be unchanged
    expect(await tempCtx.collateral.refPerTok()).to.be.closeTo(refPerTok, refPerTok.div(bn('1e3'))) // within 1-part-in-1-thousand

    // Should become DISABLED if drops another 1%
    refPerTok = await tempCtx.collateral.refPerTok()
    await reduceRefPerTok(tempCtx, bn(1))
    await tempCtx.collateral.refresh()
    expect(await tempCtx.collateral.status()).to.equal(CollateralStatus.DISABLED)

    // refPerTok should have fallen 1%
    refPerTok = refPerTok.sub(refPerTok.div(100))
    expect(await tempCtx.collateral.refPerTok()).to.be.closeTo(refPerTok, refPerTok.div(bn('1e3'))) // within 1-part-in-1-thousand
  })

  it('whitelisted Chronicle oracle works correctly', async () => {
    await resetFork() // need fresh refPerTok() to maintain peg

    const collateral = await deployCollateral(defaultUSDMCollateralOpts) // using real Chronicle oracle
    const chronicleFeed = await ethers.getContractAt('IChronicle', await collateral.chainlinkFeed())

    // Oracle reverts when attempting to read price from Plugin (specific error - non-empty)
    await whileImpersonating(collateral.address, async (pluginSigner) => {
      await expect(chronicleFeed.connect(pluginSigner).read()).to.be.revertedWithCustomError(
        chronicleFeed,
        'NotTolled'
      )
      await expect(
        chronicleFeed.connect(pluginSigner).latestRoundData()
      ).to.be.revertedWithCustomError(chronicleFeed, 'NotTolled')
    })

    // Plugin is unpriced if not whitelisted
    await expectUnpriced(collateral.address)
    expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

    // Refresh sets collateral to IFFY if not whitelisted
    await collateral.refresh()
    expect(await collateral.status()).to.equal(CollateralStatus.IFFY)

    // Whitelist plugin in Chronicle oracle
    await whileImpersonating(ARB_CHRONICLE_FEED_AUTH, async (authSigner) => {
      await expect(chronicleFeed.connect(authSigner).kiss(collateral.address)).to.emit(
        chronicleFeed,
        'TollGranted'
      )
    })

    // Plugin can now read
    await whileImpersonating(collateral.address, async (pluginSigner) => {
      await expect(chronicleFeed.connect(pluginSigner).read()).to.not.be.reverted
      await expect(chronicleFeed.connect(pluginSigner).latestRoundData()).to.not.be.reverted
    })

    // Should have a price now
    const [low, high] = await collateral.price()
    expect(low).to.be.closeTo(fp('1.02'), fp('0.01')) // close to $1.03 (chainlink answer in this block)
    expect(high).to.be.closeTo(fp('1.04'), fp('0.01'))
    expect(high).to.be.gt(low)

    // Refresh sets it back to SOUND now that it's whitelisted
    await collateral.refresh()
    expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
  })
}

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
  itHasRevenueHiding: it.skip, // implemented in this file
  collateralName: 'USDM Collateral',
  chainlinkDefaultAnswer,
  itIsPricedByPeg: true,
  resetFork,
  targetNetwork: 'arbitrum',
}

collateralTests(opts)
