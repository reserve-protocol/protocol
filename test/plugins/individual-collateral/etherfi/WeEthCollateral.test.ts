import collateralTests from '../collateralTests'
import { CollateralFixtureContext, CollateralOpts, MintCollateralFunc } from '../pluginTestTypes'
import { resetFork, mintWEETH, accrueRewards } from './helpers'
import hre, { ethers } from 'hardhat'
import { expect } from 'chai'
import { ContractFactory, BigNumberish, BigNumber } from 'ethers'
import {
  ERC20Mock,
  MockV3Aggregator,
  MockV3Aggregator__factory,
  TestICollateral,
  IWeETH,
  WeEthMock,
  WETH9,
} from '../../../../typechain'
import { pushOracleForward } from '../../../utils/oracles'
import { advanceBlocks, advanceTime, getLatestBlockTimestamp } from '../../../utils/time'
import { bn, fp } from '../../../../common/numbers'
import { CollateralStatus, ZERO_ADDRESS, MAX_UINT48 } from '../../../../common/constants'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  ETH_ORACLE_ERROR,
  ETH_ORACLE_TIMEOUT,
  PRICE_TIMEOUT,
  MAX_TRADE_VOL,
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
  WETH,
  EETH,
  WEETH,
  ETH_USD_PRICE_FEED,
  WEETH_ETH_PRICE_FEED,
  WEETH_ORACLE_TIMEOUT,
} from './constants'

/*
  Define interfaces
*/

interface WeEthCollateralFixtureContext extends CollateralFixtureContext {
  weth: WETH9
  eEth: ERC20Mock
  weEth: IWeETH
  targetPerTokChainlinkFeed: MockV3Aggregator
}

interface WeEthCollateralFixtureContextMock extends WeEthCollateralFixtureContext {
  weEthMock: WeEthMock
}

interface WeEthCollateralOpts extends CollateralOpts {
  targetPerTokChainlinkFeed?: string
  targetPerTokChainlinkTimeout?: BigNumberish
}

/*
  Define deployment functions
*/

export const defaultWeEthCollateralOpts: WeEthCollateralOpts = {
  erc20: WEETH,
  targetName: ethers.utils.formatBytes32String('ETH'),
  rewardERC20: ZERO_ADDRESS,
  priceTimeout: PRICE_TIMEOUT,
  chainlinkFeed: ETH_USD_PRICE_FEED,
  oracleTimeout: ETH_ORACLE_TIMEOUT,
  oracleError: ETH_ORACLE_ERROR,
  maxTradeVolume: MAX_TRADE_VOL,
  defaultThreshold: DEFAULT_THRESHOLD,
  delayUntilDefault: DELAY_UNTIL_DEFAULT,
  targetPerTokChainlinkFeed: WEETH_ETH_PRICE_FEED,
  targetPerTokChainlinkTimeout: WEETH_ORACLE_TIMEOUT,
  revenueHiding: fp('0'),
}

export const deployCollateral = async (
  opts: WeEthCollateralOpts = {}
): Promise<TestICollateral> => {
  opts = { ...defaultWeEthCollateralOpts, ...opts }

  const WeEthCollateralFactory: ContractFactory = await ethers.getContractFactory('WeEthCollateral')

  const collateral = <TestICollateral>await WeEthCollateralFactory.deploy(
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
  await pushOracleForward(opts.targetPerTokChainlinkFeed!)

  // sometimes we are trying to test a negative test case and we want this to fail silently
  // fortunately this syntax fails silently because our tools are terrible
  await expect(collateral.refresh())

  return collateral
}

const chainlinkDefaultAnswer = bn('1600e8')
const refPerTokChainlinkDefaultAnswer = fp('1.0283')

type Fixture<T> = () => Promise<T>

const makeCollateralFixtureContext = (
  alice: SignerWithAddress,
  opts: WeEthCollateralOpts = {}
): Fixture<WeEthCollateralFixtureContext> => {
  const collateralOpts = { ...defaultWeEthCollateralOpts, ...opts }

  const makeCollateralFixtureContext = async () => {
    const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
      await ethers.getContractFactory('MockV3Aggregator')
    )

    const chainlinkFeed = <MockV3Aggregator>(
      await MockV3AggregatorFactory.deploy(8, chainlinkDefaultAnswer)
    )

    const targetPerTokChainlinkFeed = <MockV3Aggregator>(
      await MockV3AggregatorFactory.deploy(18, refPerTokChainlinkDefaultAnswer)
    )
    collateralOpts.chainlinkFeed = chainlinkFeed.address
    collateralOpts.targetPerTokChainlinkFeed = targetPerTokChainlinkFeed.address

    const weth = (await ethers.getContractAt('WETH9', WETH)) as WETH9
    const eEth = (await ethers.getContractAt('ERC20Mock', EETH)) as ERC20Mock
    const weEth = (await ethers.getContractAt('IWeETH', WEETH)) as IWeETH
    const rewardToken = (await ethers.getContractAt('ERC20Mock', ZERO_ADDRESS)) as ERC20Mock
    const collateral = await deployCollateral(collateralOpts)

    return {
      alice,
      collateral,
      chainlinkFeed,
      weth,
      eEth,
      weEth,
      targetPerTokChainlinkFeed,
      tok: weEth,
      rewardToken,
    }
  }

  return makeCollateralFixtureContext
}

const deployCollateralWeEthMockContext = async (
  opts: WeEthCollateralOpts = {}
): Promise<WeEthCollateralFixtureContextMock> => {
  const collateralOpts = { ...defaultWeEthCollateralOpts, ...opts }

  const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
    await ethers.getContractFactory('MockV3Aggregator')
  )
  const chainlinkFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
  collateralOpts.chainlinkFeed = chainlinkFeed.address

  const MockFactory = await ethers.getContractFactory('WeEthMock')
  const erc20 = (await MockFactory.deploy()) as WeEthMock
  const currentRate = await (await ethers.getContractAt('IWeETH', WEETH)).getRate()
  await erc20.setRate(currentRate)

  const targetPerTokChainlinkFeed = <MockV3Aggregator>(
    await MockV3AggregatorFactory.deploy(18, refPerTokChainlinkDefaultAnswer)
  )
  collateralOpts.targetPerTokChainlinkFeed = targetPerTokChainlinkFeed.address

  const weth = (await ethers.getContractAt('WETH9', WETH)) as WETH9
  const eEth = (await ethers.getContractAt('ERC20Mock', EETH)) as ERC20Mock
  const weEth = (await ethers.getContractAt('IWeETH', WEETH)) as IWeETH

  collateralOpts.erc20 = erc20.address
  const collateral = await deployCollateral(collateralOpts)

  return {
    weth,
    collateral,
    chainlinkFeed,
    targetPerTokChainlinkFeed,
    eEth,
    weEth,
    weEthMock: erc20,
    tok: erc20,
  }
}

/*
  Define helper functions
*/

const mintCollateralTo: MintCollateralFunc<WeEthCollateralFixtureContext> = async (
  ctx: WeEthCollateralFixtureContext,
  amount: BigNumberish,
  user: SignerWithAddress,
  recipient: string
) => {
  await mintWEETH(ctx.weEth, user, amount, recipient)
}

const changeTargetPerRef = async (ctx: WeEthCollateralFixtureContext, percentChange: BigNumber) => {
  // We leave the actual refPerTok exchange where it is and just change {target/tok}
  {
    const lastRound = await ctx.targetPerTokChainlinkFeed.latestRoundData()
    const nextAnswer = lastRound.answer.add(lastRound.answer.mul(percentChange).div(100))
    await ctx.targetPerTokChainlinkFeed.updateAnswer(nextAnswer)
  }
}

const reduceTargetPerRef = async (
  ctx: WeEthCollateralFixtureContext,
  pctDecrease: BigNumberish
) => {
  await changeTargetPerRef(ctx, bn(pctDecrease).mul(-1))
}

const increaseTargetPerRef = async (
  ctx: WeEthCollateralFixtureContext,
  pctDecrease: BigNumberish
) => {
  await changeTargetPerRef(ctx, bn(pctDecrease))
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const reduceRefPerTok = async (ctx: WeEthCollateralFixtureContext, pctDecrease: BigNumberish) => {
  await hre.network.provider.send('evm_mine', [])
}

// prettier-ignore
const increaseRefPerTok = async (
  ctx: WeEthCollateralFixtureContext,
  pctIncrease: BigNumberish
) => {
  // Get current rate
  const currentRate = await ctx.weEth.getRate()

  // Calculate reward amount needed to increase rate by pctIncrease
  const rewardAmount = currentRate.mul(pctIncrease).div(100)

  // Accrue rewards through LiquidityPool.rebase()
  await accrueRewards(rewardAmount)

  await advanceBlocks(86400 / 12)
  await advanceTime(86400)

  // Push chainlink oracles forward so that tryPrice() still works
  const latestRoundData = await ctx.chainlinkFeed.latestRoundData()
  await ctx.chainlinkFeed.updateAnswer(latestRoundData.answer)

  // Adjust weETH/ETH chainlink price as well to reflect the new rate
  const lastRound = await ctx.targetPerTokChainlinkFeed.latestRoundData()
  const nextAnswer = lastRound.answer.add(lastRound.answer.mul(pctIncrease).div(100))
  await ctx.targetPerTokChainlinkFeed.updateAnswer(nextAnswer)
}

const getExpectedPrice = async (ctx: WeEthCollateralFixtureContext): Promise<BigNumber> => {
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
const collateralSpecificStatusTests = () => {
  it('does revenue hiding correctly', async () => {
    const { collateral, weEthMock } = await deployCollateralWeEthMockContext({
      revenueHiding: fp('0.01'),
    })

    const currentRate = await (await ethers.getContractAt('IWeETH', WEETH)).getRate()

    // Should remain SOUND after a 1% decrease
    let refPerTok = await collateral.refPerTok()
    const newRate = currentRate.sub(currentRate.div(100))
    await weEthMock.setRate(newRate)
    await collateral.refresh()
    expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

    // refPerTok should be unchanged
    expect(await collateral.refPerTok()).to.be.closeTo(refPerTok, refPerTok.div(bn('1e3'))) // within 1-part-in-1-thousand

    // Should become DISABLED if drops another 1%
    refPerTok = await collateral.refPerTok()
    await weEthMock.setRate(newRate.sub(newRate.div(100)))
    await collateral.refresh()
    expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)

    // refPerTok should have fallen 1%
    refPerTok = refPerTok.sub(refPerTok.div(100))
    expect(await collateral.refPerTok()).to.be.closeTo(refPerTok, refPerTok.div(bn('1e3'))) // within 1-part-in-1-thousand
  })

  it('enters DISABLED state when refPerTok() decreases', async () => {
    const { collateral, weEthMock } = await deployCollateralWeEthMockContext({
      revenueHiding: fp('0.01'),
    })

    // Check initial state
    expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
    expect(await collateral.whenDefault()).to.equal(MAX_UINT48)
    await expect(collateral.refresh()).to.not.emit(collateral, 'CollateralStatusChanged')

    // Should default instantly after 10% drop (beyond revenue hiding threshold)
    const currentRate = await weEthMock.getRate()
    await weEthMock.setRate(currentRate.sub(currentRate.mul(10).div(100)))
    await expect(collateral.refresh()).to.emit(collateral, 'CollateralStatusChanged')
    expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)
    expect(await collateral.whenDefault()).to.equal(await getLatestBlockTimestamp())
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
  itChecksRefPerTokDefault: it.skip, // implemented in this file
  itChecksPriceChanges: it,
  itChecksNonZeroDefaultThreshold: it,
  itHasRevenueHiding: it.skip, // implemented in this file
  resetFork,
  collateralName: 'WeETH',
  chainlinkDefaultAnswer,
  itIsPricedByPeg: true,
}

collateralTests(opts)
