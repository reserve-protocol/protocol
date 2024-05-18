import collateralTests from '../collateralTests'
import { CollateralFixtureContext, CollateralOpts, MintCollateralFunc } from '../pluginTestTypes'
import { resetFork, mintCHAR } from './helpers'
import hre, { ethers } from 'hardhat'
import { expect } from 'chai'
import { ContractFactory, BigNumberish, BigNumber } from 'ethers'
import {
  ERC20Mock,
  MockV3Aggregator,
  MockV3Aggregator__factory,
  TestICollateral,
  CHAR,
  CHARMock,
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
  CHAR,
  ETH_USD_PRICE_FEED,
  CHAR_PRICE_FEED,
} from './constants'
import { whileImpersonating } from '#/test/utils/impersonation'

/*
  Define interfaces
*/

interface CHARCollateralFixtureContext extends CollateralFixtureContext {
  weth: WETH9
  CHAR: ERC20Mock
  ICHAR: ICHAR
  targetPerTokChainlinkFeed: MockV3Aggregator
}

interface CHARCollateralFixtureContextMock extends CHARCollateralFixtureContext {
  CHARMock: CHARMock
}

interface CHARCollateralOpts extends CollateralOpts {
  targetPerTokChainlinkFeed?: string
  targetPerTokChainlinkTimeout?: BigNumberish
}

/*
  Define deployment functions
*/

export const defaultCHARCollateralOpts: ApxEthCollateralOpts = {
  erc20: CHAR,
  targetName: ethers.utils.formatBytes32String('CHAR'),
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
  opts: CHARCollateralOpts = {}
): Promise<TestICollateral> => {
  opts = { ...defaultApxEthCollateralOpts, ...opts }

  const CHARCollateralFactory: ContractFactory = await ethers.getContractFactory(
    'CHARCollateral'
  )

  const collateral = <TestICollateral>await CHARCollateralFactory.deploy(
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
): Fixture<CHARCollateralFixtureContext> => {
  const collateralOpts = { ...defaultCHARCollateralOpts, ...opts }

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
    const CHAR = (await ethers.getContractAt('ERC20Mock', CHAR)) as ERC20Mock
    const CHAR = (await ethers.getContractAt('IApxETH', CHAR)) as ICHAR
    const rewardToken = (await ethers.getContractAt('ERC20Mock', ZERO_ADDRESS)) as ERC20Mock
    const collateral = await deployCollateral(collateralOpts)

    return {
      alice,
      collateral,
      chainlinkFeed,
      weth,
      CHAR,
      ICHAR,
      targetPerTokChainlinkFeed,
      tok: CHAR,
      rewardToken,
    }
  }

  return makeCollateralFixtureContext
}

const deployCollateralCHARMockContext = async (
  opts: CHARCollateralOpts = {}
): Promise<CHARCollateralFixtureContextMock> => {
  const collateralOpts = { ...defaultCHARCollateralOpts, ...opts }

  const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
    await ethers.getContractFactory('MockV3Aggregator')
  )
  const chainlinkFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
  collateralOpts.chainlinkFeed = chainlinkFeed.address

  const MockFactory = await ethers.getContractFactory('CHARMock')
  const erc20 = (await MockFactory.deploy()) as CHARMock
  const currentAPS = await (await ethers.getContractAt('CHAR', CHAR)).assetsPerShare()
  await erc20.setAssetsPerShare(currentAPS)

  const targetPerTokChainlinkFeed = <MockV3Aggregator>(
    await MockV3AggregatorFactory.deploy(18, refPerTokChainlinkDefaultAnswer)
  )
  collateralOpts.targetPerTokChainlinkFeed = targetPerTokChainlinkFeed.address

  const weth = (await ethers.getContractAt('WETH9', WETH)) as WETH9
  const CHAR = (await ethers.getContractAt('ERC20Mock', CHAR)) as ERC20Mock
  const ICHAR = (await ethers.getContractAt('ICHAR', CHAR)) as ICHAR

  collateralOpts.erc20 = erc20.address
  const collateral = await deployCollateral(collateralOpts)

  return {
    weth,
    collateral,
    chainlinkFeed,
    targetPerTokChainlinkFeed,
    CHAR,
    ICHAR,
    CHARMock: erc20,
    tok: erc20,
  }
}

/*
  Define helper functions
*/

const mintCollateralTo: MintCollateralFunc<ApxEthCollateralFixtureContext> = async (
  ctx: CHARCollateralFixtureContext,
  amount: BigNumberish,
  user: SignerWithAddress,
  recipient: string
) => {
  await mintCHAR(ctx.CHAR, user, amount, recipient)
}

const changeTargetPerRef = async (
  ctx: CHARCollateralFixtureContext,
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
  ctx: PCHARCollateralFixtureContext,
  pctDecrease: BigNumberish
) => {
  await changeTargetPerRef(ctx, bn(pctDecrease).mul(-1))
}

const increaseTargetPerRef = async (
  ctx: CHARCollateralFixtureContext,
  pctDecrease: BigNumberish
) => {
  await changeTargetPerRef(ctx, bn(pctDecrease))
}

const reduceRefPerTok = async (ctx: ApxEthCollateralFixtureContext, pctDecrease: BigNumberish) => {
  await hre.network.provider.send('evm_mine', [])
}

// prettier-ignore
const increaseRefPerTok = async (
  ctx: CHARCollateralFixtureContext,
  pctIncrease: BigNumberish 
) => {
  const currentBal = await ctx.pxETH.balanceOf(ctx.CHAR.address)
  const addBal = currentBal.mul(pctIncrease).div(100)

  await mintPxETH(ctx.pxEth, ctx.alice!, addBal, ctx.apxEth.address)
  await advanceBlocks(86400 / 12)
  await advanceTime(86400)

  // Notify rewards
  await whileImpersonating(CHAR, async (CHARSigner) => {
    await ctx.apxEth.connect(CHARSigner).notifyRewardAmount()
  })

  // push chainlink oracles forward so that tryPrice() still works
  const latestRoundData = await ctx.chainlinkFeed.latestRoundData()
  await ctx.chainlinkFeed.updateAnswer(latestRoundData.answer)

  // Adjust apxETH/ETH price as well
  const lastRound = await ctx.targetPerTokChainlinkFeed.latestRoundData()
  const nextAnswer = lastRound.answer.add(lastRound.answer.mul(pctIncrease).div(100))
  await ctx.targetPerTokChainlinkFeed.updateAnswer(nextAnswer)
}

const getExpectedPrice = async (ctx: CHARCollateralFixtureContext): Promise<BigNumber> => {
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
    const { collateral, apxEthMock } = await deployCollateralCHARMockContext({
      revenueHiding: fp('0.01'),
    })

    const currentAPS = await (await ethers.getContractAt('ICHAR', CHAR)).assetsPerShare()

    // Should remain SOUND after a 1% decrease
    let refPerTok = await collateral.refPerTok()
    const newAPS = currentAPS.sub(currentAPS.div(100))
    await CHARMock.setAssetsPerShare(newAPS)
    await collateral.refresh()
    expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

    // refPerTok should be unchanged
    expect(await collateral.refPerTok()).to.be.closeTo(refPerTok, refPerTok.div(bn('1e3'))) // within 1-part-in-1-thousand

    // Should become DISABLED if drops another 1%
    refPerTok = await collateral.refPerTok()
    await CHARMock.setAssetsPerShare(newAPS.sub(newAPS.div(100)))
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
    await CHARMock.setAssetsPerShare(currentAPS.sub(currentAPS.mul(10).div(100)))
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