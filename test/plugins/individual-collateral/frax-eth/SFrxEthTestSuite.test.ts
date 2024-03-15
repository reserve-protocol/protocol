import collateralTests from '../collateralTests'
import { CollateralFixtureContext, CollateralOpts, MintCollateralFunc } from '../pluginTestTypes'
import { resetFork, mintSfrxETH, mintFrxETH } from './helpers'
import hre, { ethers } from 'hardhat'
import { expect } from 'chai'
import { ContractFactory, BigNumberish, BigNumber } from 'ethers'
import {
  ERC20Mock,
  MockV3Aggregator,
  MockV3Aggregator__factory,
  SfraxEthMock,
  TestICollateral,
  IsfrxEth,
  EmaPriceOracleStableSwapMock__factory,
  EmaPriceOracleStableSwapMock,
} from '../../../../typechain'
import { pushOracleForward } from '../../../utils/oracles'
import { bn, fp } from '../../../../common/numbers'
import { CollateralStatus, ZERO_ADDRESS } from '../../../../common/constants'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  PRICE_TIMEOUT,
  ORACLE_ERROR,
  ORACLE_TIMEOUT,
  MAX_TRADE_VOL,
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
  FRX_ETH,
  SFRX_ETH,
  ETH_USD_PRICE_FEED,
  CURVE_POOL_EMA_PRICE_ORACLE_ADDRESS,
} from './constants'
import {
  advanceTime,
  setNextBlockTimestamp,
  getLatestBlockTimestamp,
  advanceBlocks,
} from '../../../utils/time'

/*
  Define interfaces
*/

interface SFrxEthCollateralFixtureContext extends CollateralFixtureContext {
  frxEth: ERC20Mock
  sfrxEth: IsfrxEth
  curveEmaOracle: EmaPriceOracleStableSwapMock
}

/*
  Define deployment functions
*/

interface SfrxEthCollateralOpts extends CollateralOpts {
  curvePoolEmaPriceOracleAddress?: string
  _minimumCurvePoolEma?: BigNumberish
  _maximumCurvePoolEma?: BigNumberish
}

export const defaultSFrxEthCollateralOpts: SfrxEthCollateralOpts = {
  erc20: SFRX_ETH,
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
  curvePoolEmaPriceOracleAddress: CURVE_POOL_EMA_PRICE_ORACLE_ADDRESS,
  _minimumCurvePoolEma: 0,
  _maximumCurvePoolEma: fp(1),
}

export const deployCollateral = async (
  opts: SfrxEthCollateralOpts = {}
): Promise<TestICollateral> => {
  opts = { ...defaultSFrxEthCollateralOpts, ...opts }

  const SFraxEthCollateralFactory: ContractFactory = await ethers.getContractFactory(
    'SFraxEthCollateral'
  )

  const collateral = <TestICollateral>await SFraxEthCollateralFactory.deploy(
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
    opts.curvePoolEmaPriceOracleAddress ?? CURVE_POOL_EMA_PRICE_ORACLE_ADDRESS,
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

type Fixture<T> = () => Promise<T>

const makeCollateralFixtureContext = (
  alice: SignerWithAddress,
  opts: CollateralOpts = {}
): Fixture<SFrxEthCollateralFixtureContext> => {
  const collateralOpts = { ...defaultSFrxEthCollateralOpts, ...opts }

  const makeCollateralFixtureContext = async () => {
    const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
      await ethers.getContractFactory('MockV3Aggregator')
    )

    const chainlinkFeed = <MockV3Aggregator>(
      await MockV3AggregatorFactory.deploy(8, chainlinkDefaultAnswer)
    )
    collateralOpts.chainlinkFeed = chainlinkFeed.address

    const EmaPriceOracleStableSwapMockFactory = <EmaPriceOracleStableSwapMock__factory>(
      await ethers.getContractFactory('EmaPriceOracleStableSwapMock')
    )

    const curveEmaOracle = <EmaPriceOracleStableSwapMock>(
      await EmaPriceOracleStableSwapMockFactory.deploy(fp('0.997646'))
    )
    collateralOpts.curvePoolEmaPriceOracleAddress = curveEmaOracle.address

    const frxEth = (await ethers.getContractAt('ERC20Mock', FRX_ETH)) as ERC20Mock
    const sfrxEth = (await ethers.getContractAt('IsfrxEth', SFRX_ETH)) as IsfrxEth
    const collateral = await deployCollateral(collateralOpts)

    return {
      alice,
      collateral,
      chainlinkFeed,
      frxEth,
      sfrxEth,
      curveEmaOracle,
      tok: sfrxEth,
    }
  }

  return makeCollateralFixtureContext
}

/*
  Define helper functions
*/

const mintCollateralTo: MintCollateralFunc<SFrxEthCollateralFixtureContext> = async (
  ctx: SFrxEthCollateralFixtureContext,
  amount: BigNumberish,
  user: SignerWithAddress,
  recipient: string
) => {
  await mintSfrxETH(ctx.sfrxEth, user, amount, recipient, ctx.chainlinkFeed)
}

const changeTargetPerRef = async (
  ctx: SFrxEthCollateralFixtureContext,
  percentChange: BigNumber
) => {
  const initPrice = await ctx.curveEmaOracle.price_oracle()
  await ctx.curveEmaOracle.setPrice(initPrice.add(initPrice.mul(percentChange).div(100)))
}

const reduceTargetPerRef = async (
  ctx: SFrxEthCollateralFixtureContext,
  pctDecrease: BigNumberish
) => {
  await changeTargetPerRef(ctx, bn(pctDecrease).mul(-1))
}

const increaseTargetPerRef = async (
  ctx: SFrxEthCollateralFixtureContext,
  pctIncrease: BigNumberish
) => {
  await changeTargetPerRef(ctx, bn(pctIncrease))
}

// prettier-ignore
const reduceRefPerTok = async () => {
    await hre.network.provider.send('evm_mine', [])
}

// prettier-ignore
const increaseRefPerTok = async (
  ctx: SFrxEthCollateralFixtureContext,
  pctIncrease: BigNumberish 
) => {
  const currentBal = await ctx.frxEth.balanceOf(ctx.sfrxEth.address)
  const addBal = currentBal.mul(pctIncrease).div(100)
  await mintFrxETH(ctx.frxEth, ctx.alice!, addBal, ctx.sfrxEth.address)
  const rewardCycleEnd = await ctx.sfrxEth.rewardsCycleEnd()
  const nextTimestamp = await getLatestBlockTimestamp()
  if (nextTimestamp < rewardCycleEnd) {
    await setNextBlockTimestamp(rewardCycleEnd + 1)
    await hre.network.provider.send('evm_mine', [])
  }
  await ctx.sfrxEth.syncRewards()
  await advanceBlocks(86400 / 12)
  await advanceTime(86400)
  // push chainlink oracle forward so that tryPrice() still works
  const latestRoundData = await ctx.chainlinkFeed.latestRoundData()
  await ctx.chainlinkFeed.updateAnswer(latestRoundData.answer)
}

const getExpectedPrice = async (ctx: SFrxEthCollateralFixtureContext): Promise<BigNumber> => {
  // Peg Feed
  const clData = await ctx.chainlinkFeed.latestRoundData()
  const clDecimals = await ctx.chainlinkFeed.decimals()

  const clTpRData = await ctx.curveEmaOracle.price_oracle()
  const clTpRDecimals = await ctx.curveEmaOracle.decimals()

  const refPerTok = await ctx.sfrxEth.pricePerShare()

  return clData.answer
    .mul(bn(10).pow(18 - clDecimals))
    .mul(clTpRData.mul(bn(10).pow(bn(18).sub(clTpRDecimals))))
    .div(fp('1'))
    .mul(refPerTok)
    .div(fp('1'))
}

/*
  Define collateral-specific tests
*/

// eslint-disable-next-line @typescript-eslint/no-empty-function
const collateralSpecificConstructorTests = () => {}

// eslint-disable-next-line @typescript-eslint/no-empty-function
const collateralSpecificStatusTests = () => {
  it('does revenue hiding correctly', async () => {
    const MockFactory = await ethers.getContractFactory('SfraxEthMock')
    const erc20 = (await MockFactory.deploy()) as SfraxEthMock
    let currentPPS = await (await ethers.getContractAt('IsfrxEth', SFRX_ETH)).pricePerShare()
    currentPPS = currentPPS.sub(currentPPS.div(1000)) // backoff slightly
    await erc20.setPricePerShare(currentPPS)

    const chainlinkFeed = <MockV3Aggregator>(
      await (await ethers.getContractFactory('MockV3Aggregator')).deploy(8, chainlinkDefaultAnswer)
    )

    const collateral = await deployCollateral({
      erc20: erc20.address,
      revenueHiding: fp('0.01'),
      chainlinkFeed: chainlinkFeed.address,
    })

    // Should remain SOUND after a 1% decrease
    let refPerTok = await collateral.refPerTok()
    const newPPS = currentPPS.sub(currentPPS.div(100))
    await erc20.setPricePerShare(newPPS)
    await collateral.refresh()
    expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

    // refPerTok should be unchanged
    expect(await collateral.refPerTok()).to.be.closeTo(refPerTok, refPerTok.div(bn('1e3'))) // within 1-part-in-1-thousand

    // Should become DISABLED if drops another 1%
    refPerTok = await collateral.refPerTok()
    await erc20.setPricePerShare(newPPS.sub(newPPS.div(100)))
    await collateral.refresh()
    expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)

    // refPerTok should have fallen 1%
    refPerTok = refPerTok.sub(refPerTok.div(100))
    expect(await collateral.refPerTok()).to.be.closeTo(refPerTok, refPerTok.div(bn('1e3'))) // within 1-part-in-1-thousand
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
  itChecksTargetPerRefDefaultUp: it.skip,
  itChecksRefPerTokDefault: it.skip,
  itChecksPriceChanges: it,
  itHasRevenueHiding: it.skip, // implemnted in this file
  itChecksNonZeroDefaultThreshold: it,
  resetFork,
  collateralName: 'SFraxEthCollateral',
  chainlinkDefaultAnswer,
  itIsPricedByPeg: true,
}

collateralTests(opts)
