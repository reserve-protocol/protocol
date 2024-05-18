import collateralTests from '../collateralTests'
import { CollateralFixtureContext, CollateralOpts, MintCollateralFunc } from '../pluginTestTypes'
import { resetFork, mintEWT } from './helpers'
import hre, { ethers } from 'hardhat'
import { expect } from 'chai'
import { ContractFactory, BigNumberish, BigNumber } from 'ethers'
import {
  ERC20Mock,
  MockV3Aggregator,
  MockV3Aggregator__factory,
  TestICollateral,
  EWT,
  EWTMock,
  WETH9,
} from '../../../../typechain'
import { pushOracleForward } from '../../../utils/oracles'
import { advanceBlocks, advanceTime, getLatestBlockTimestamp } from '../../../utils/time'
import { bn, fp } from '../../../../common/numbers'
import { CollateralStatus, ZERO_ADDRESS, MAX_UINT48 } from '../../../../common/constants'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  ORACLE_ERROR,
  ORACLE_TIMEOUT,
  PRICE_TIMEOUT,
  MAX_TRADE_VOL,
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
  WETH,
  EWT,
  ETH_USD_PRICE_FEED,
  EWT_PRICE_FEED,
} from './constants'
import { whileImpersonating } from '#/test/utils/impersonation'

/*
  Define interfaces
*/

interface EWTCollateralFixtureContext extends CollateralFixtureContext {
  weth: WETH9
  EWT: ERC20Mock
  IEWT: IEWT
  targetPerTokChainlinkFeed: MockV3Aggregator
}

interface EWTCollateralFixtureContextMock extends EWTCollateralFixtureContext {
  EWTMock: EWTMock
}

interface EWTCollateralOpts extends CollateralOpts {
  targetPerTokChainlinkFeed?: string
  targetPerTokChainlinkTimeout?: BigNumberish
}

/*
  Define deployment functions
*/

export const defaultEWTCollateralOpts: ApxEthCollateralOpts = {
  erc20: EWT,
  targetName: ethers.utils.formatBytes32String('EWT'),
  rewardERC20: ZERO_ADDRESS,
  priceTimeout: PRICE_TIMEOUT,
  chainlinkFeed: ETH_USD_PRICE_FEED,
  oracleTimeout: ORACLE_TIMEOUT,
  oracleError: ORACLE_ERROR,
  maxTradeVolume: MAX_TRADE_VOL,
  defaultThreshold: DEFAULT_THRESHOLD,
  delayUntilDefault: DELAY_UNTIL_DEFAULT,
  targetPerTokChainlinkFeed: APXETH_ETH_PRICE_FEED,
  targetPerTokChainlinkTimeout: ORACLE_TIMEOUT,
  revenueHiding: fp('0'),
}

export const deployCollateral = async (
  opts: EWTCollateralOpts = {}
): Promise<TestICollateral> => {
  opts = { ...defaultApxEthCollateralOpts, ...opts }

  const EWTCollateralFactory: ContractFactory = await ethers.getContractFactory(
    'EWTCollateral'
  )

  const collateral = <TestICollateral>await EWTCollateralFactory.deploy(
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
  opts: ApxEthCollateralOpts = {}
): Fixture<EWTCollateralFixtureContext> => {
  const collateralOpts = { ...defaultEWTCollateralOpts, ...opts }

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
    const EWT = (await ethers.getContractAt('ERC20Mock', EWT)) as ERC20Mock
    const EWT = (await ethers.getContractAt('IApxETH', EWT)) as IEWT
    const rewardToken = (await ethers.getContractAt('ERC20Mock', ZERO_ADDRESS)) as ERC20Mock
    const collateral = await deployCollateral(collateralOpts)

    return {
      alice,
      collateral,
      chainlinkFeed,
      weth,
      EWT,
      IEWT,
      targetPerTokChainlinkFeed,
      tok: EWT,
      rewardToken,
    }
  }

  return makeCollateralFixtureContext
}

const deployCollateralEWTMockContext = async (
  opts: EWTCollateralOpts = {}
): Promise<EWTCollateralFixtureContextMock> => {
  const collateralOpts = { ...defaultEWTCollateralOpts, ...opts }

  const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
    await ethers.getContractFactory('MockV3Aggregator')
  )
  const chainlinkFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
  collateralOpts.chainlinkFeed = chainlinkFeed.address

  const MockFactory = await ethers.getContractFactory('EWTMock')
  const erc20 = (await MockFactory.deploy()) as EWTMock
  const currentAPS = await (await ethers.getContractAt('EWT', EWT)).assetsPerShare()
  await erc20.setAssetsPerShare(currentAPS)

  const targetPerTokChainlinkFeed = <MockV3Aggregator>(
    await MockV3AggregatorFactory.deploy(18, refPerTokChainlinkDefaultAnswer)
  )
  collateralOpts.targetPerTokChainlinkFeed = targetPerTokChainlinkFeed.address

  const weth = (await ethers.getContractAt('WETH9', WETH)) as WETH9
  const EWT = (await ethers.getContractAt('ERC20Mock', EWT)) as ERC20Mock
  const IEWT = (await ethers.getContractAt('IEWT', EWT)) as IEWT

  collateralOpts.erc20 = erc20.address
  const collateral = await deployCollateral(collateralOpts)

  return {
    weth,
    collateral,
    chainlinkFeed,
    targetPerTokChainlinkFeed,
    EWT,
    IEWT,
    EWTMock: erc20,
    tok: erc20,
  }
}

/*
  Define helper functions
*/

const mintCollateralTo: MintCollateralFunc<ApxEthCollateralFixtureContext> = async (
  ctx: EWTCollateralFixtureContext,
  amount: BigNumberish,
  user: SignerWithAddress,
  recipient: string
) => {
  await mintEWT(ctx.EWT, user, amount, recipient)
}

const changeTargetPerRef = async (
  ctx: EWTCollateralFixtureContext,
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
  ctx: PEWTCollateralFixtureContext,
  pctDecrease: BigNumberish
) => {
  await changeTargetPerRef(ctx, bn(pctDecrease).mul(-1))
}

const increaseTargetPerRef = async (
  ctx: EWTCollateralFixtureContext,
  pctDecrease: BigNumberish
) => {
  await changeTargetPerRef(ctx, bn(pctDecrease))
}

const reduceRefPerTok = async (ctx: ApxEthCollateralFixtureContext, pctDecrease: BigNumberish) => {
  await hre.network.provider.send('evm_mine', [])
}

// prettier-ignore
const increaseRefPerTok = async (
  ctx: EWTCollateralFixtureContext,
  pctIncrease: BigNumberish 
) => {
  const currentBal = await ctx.pxETH.balanceOf(ctx.EWT.address)
  const addBal = currentBal.mul(pctIncrease).div(100)

  await mintPxETH(ctx.pxEth, ctx.alice!, addBal, ctx.apxEth.address)
  await advanceBlocks(86400 / 12)
  await advanceTime(86400)

  // Notify rewards
  await whileImpersonating(EWT, async (EWTSigner) => {
    await ctx.apxEth.connect(EWTSigner).notifyRewardAmount()
  })

  // push chainlink oracles forward so that tryPrice() still works
  const latestRoundData = await ctx.chainlinkFeed.latestRoundData()
  await ctx.chainlinkFeed.updateAnswer(latestRoundData.answer)

  // Adjust apxETH/ETH price as well
  const lastRound = await ctx.targetPerTokChainlinkFeed.latestRoundData()
  const nextAnswer = lastRound.answer.add(lastRound.answer.mul(pctIncrease).div(100))
  await ctx.targetPerTokChainlinkFeed.updateAnswer(nextAnswer)
}

const getExpectedPrice = async (ctx: EWTCollateralFixtureContext): Promise<BigNumber> => {
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
    const { collateral, apxEthMock } = await deployCollateralEWTMockContext({
      revenueHiding: fp('0.01'),
    })

    const currentAPS = await (await ethers.getContractAt('IEWT', EWT)).assetsPerShare()

    // Should remain SOUND after a 1% decrease
    let refPerTok = await collateral.refPerTok()
    const newAPS = currentAPS.sub(currentAPS.div(100))
    await EWTMock.setAssetsPerShare(newAPS)
    await collateral.refresh()
    expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

    // refPerTok should be unchanged
    expect(await collateral.refPerTok()).to.be.closeTo(refPerTok, refPerTok.div(bn('1e3'))) // within 1-part-in-1-thousand

    // Should become DISABLED if drops another 1%
    refPerTok = await collateral.refPerTok()
    await EWTMock.setAssetsPerShare(newAPS.sub(newAPS.div(100)))
    await collateral.refresh()
    expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)

    // refPerTok should have fallen 1%
    refPerTok = refPerTok.sub(refPerTok.div(100))
    expect(await collateral.refPerTok()).to.be.closeTo(refPerTok, refPerTok.div(bn('1e3'))) // within 1-part-in-1-thousand
  })

  it('enters DISABLED state when refPerTok() decreases', async () => {
    const { collateral, apxEthMock } = await deployCollateralApxEthMockContext({
      revenueHiding: fp('0.01'),
    })

    // Check initial state
    expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
    expect(await collateral.whenDefault()).to.equal(MAX_UINT48)
    await expect(collateral.refresh()).to.not.emit(collateral, 'CollateralStatusChanged')

    // Should default instantly after 10% drop
    const currentAPS = await apxEthMock.assetsPerShare()
    await EWTMock.setAssetsPerShare(currentAPS.sub(currentAPS.mul(10).div(100)))
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
  collateralName: 'ApxETH',
  chainlinkDefaultAnswer,
  itIsPricedByPeg: true,
}

collateralTests(opts)