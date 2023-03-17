import collateralTests from '../collateralTests'
import { CollateralFixtureContext, CollateralOpts, MintCollateralFunc } from '../pluginTestTypes'
import { resetFork, mintSfrxETH, mintFrxETH } from './helpers'
import hre, { ethers } from 'hardhat'
import { ContractFactory, BigNumberish, BigNumber } from 'ethers'
import {
  MockV3Aggregator,
  MockV3Aggregator__factory,
  ICollateral,
  ERC20Mock,
  IsfrxEth,
} from '../../../../typechain'
import { bn, fp } from '../../../../common/numbers'
import { ZERO_ADDRESS } from '../../../../common/constants'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  ORACLE_ERROR,
  ORACLE_TIMEOUT,
  MAX_TRADE_VOL,
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
  WETH,
  FRX_ETH,
  SFRX_ETH,
  ETH_USD_PRICE_FEED,
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
}

/*
  Define deployment functions
*/

export const defaultRethCollateralOpts: CollateralOpts = {
  erc20: SFRX_ETH,
  targetName: ethers.utils.formatBytes32String('USD'),
  rewardERC20: WETH,
  priceTimeout: ORACLE_TIMEOUT,
  chainlinkFeed: ETH_USD_PRICE_FEED,
  oracleTimeout: ORACLE_TIMEOUT,
  oracleError: ORACLE_ERROR,
  maxTradeVolume: MAX_TRADE_VOL,
  defaultThreshold: DEFAULT_THRESHOLD,
  delayUntilDefault: DELAY_UNTIL_DEFAULT,
}

export const deployCollateral = async (opts: CollateralOpts = {}): Promise<ICollateral> => {
  opts = { ...defaultRethCollateralOpts, ...opts }

  const SFraxEthCollateralFactory: ContractFactory = await ethers.getContractFactory(
    'SFraxEthCollateral'
  )

  const collateral = <ICollateral>await SFraxEthCollateralFactory.deploy(
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
    0,
    { gasLimit: 2000000000 }
  )
  await collateral.deployed()

  return collateral
}

const chainlinkDefaultAnswer = bn('1600e8')

type Fixture<T> = () => Promise<T>

const makeCollateralFixtureContext = (
  alice: SignerWithAddress,
  opts: CollateralOpts = {}
): Fixture<SFrxEthCollateralFixtureContext> => {
  const collateralOpts = { ...defaultRethCollateralOpts, ...opts }

  const makeCollateralFixtureContext = async () => {
    const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
      await ethers.getContractFactory('MockV3Aggregator')
    )

    const chainlinkFeed = <MockV3Aggregator>(
      await MockV3AggregatorFactory.deploy(8, chainlinkDefaultAnswer)
    )
    collateralOpts.chainlinkFeed = chainlinkFeed.address

    const frxEth = (await ethers.getContractAt('ERC20Mock', FRX_ETH)) as ERC20Mock
    const sfrxEth = (await ethers.getContractAt('IsfrxEth', SFRX_ETH)) as IsfrxEth
    const rewardToken = (await ethers.getContractAt('ERC20Mock', ZERO_ADDRESS)) as ERC20Mock
    const collateral = await deployCollateral(collateralOpts)
    const tokDecimals = await sfrxEth.decimals()

    return {
      alice,
      collateral,
      chainlinkFeed,
      frxEth,
      sfrxEth,
      tok: sfrxEth,
      rewardToken,
      tokDecimals,
    }
  }

  return makeCollateralFixtureContext
}

// const deployCollateralCometMockContext = async (
//   opts: CometCollateralOpts = {}
// ): Promise<SFrxEthCollateralFixtureContextMockComet> => {
//   const collateralOpts = { ...defaultCometCollateralOpts, ...opts }

//   const MockV3AggregatorFactory = <MockV3Aggregator__factory>(
//     await ethers.getContractFactory('MockV3Aggregator')
//   )
//   const chainlinkFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(6, bn('1e6'))
//   collateralOpts.chainlinkFeed = chainlinkFeed.address

//   const CometFactory = <CometMock__factory>await ethers.getContractFactory('CometMock')
//   const cusdcV3 = <CometMock>await CometFactory.deploy(bn('5e15'), bn('1e15'), CUSDC_V3)

//   const CusdcV3WrapperFactory = <CusdcV3Wrapper__factory>(
//     await ethers.getContractFactory('CusdcV3Wrapper')
//   )
//   const wcusdcV3 = <ICusdcV3Wrapper>(
//     await CusdcV3WrapperFactory.deploy(cusdcV3.address, REWARDS, COMP)
//   )
//   const CusdcV3WrapperMockFactory = <CusdcV3WrapperMock__factory>(
//     await ethers.getContractFactory('CusdcV3WrapperMock')
//   )
//   const wcusdcV3Mock = await (<ICusdcV3WrapperMock>(
//     await CusdcV3WrapperMockFactory.deploy(wcusdcV3.address)
//   ))

//   const realMock = (await ethers.getContractAt(
//     'ICusdcV3WrapperMock',
//     wcusdcV3Mock.address
//   )) as ICusdcV3WrapperMock
//   collateralOpts.erc20 = wcusdcV3.address
//   collateralOpts.erc20 = realMock.address
//   const usdc = <ERC20Mock>await ethers.getContractAt('ERC20Mock', USDC)
//   const collateral = await deployCollateral(collateralOpts)

//   const rewardToken = <ERC20Mock>await ethers.getContractAt('ERC20Mock', COMP)
//   const tokDecimals = await wcusdcV3.decimals()

//   return {
//     collateral,
//     chainlinkFeed,
//     cusdcV3,
//     wcusdcV3: <ICusdcV3WrapperMock>wcusdcV3Mock,
//     wcusdcV3Mock,
//     usdc,
//     tok: wcusdcV3,
//     rewardToken,
//     tokDecimals,
//   }
// }

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

// eslint-disable-next-line @typescript-eslint/no-empty-function
const reduceTargetPerRef = async () => {}

// eslint-disable-next-line @typescript-eslint/no-empty-function
const increaseTargetPerRef = async () => {}

// prettier-ignore
const reduceRefPerTok = async () => {
  await hre.network.provider.send('evm_mine', [])
}

// prettier-ignore
const increaseRefPerTok = async (
  ctx: SFrxEthCollateralFixtureContext,
  pctIncrease: BigNumberish | undefined
) => {
  const currentBal = await ctx.frxEth.balanceOf(ctx.sfrxEth.address)
  const addBal = currentBal.mul(pctIncrease!).div(100)
  await mintFrxETH(ctx.frxEth, ctx.alice!, addBal, ctx.sfrxEth.address)
  const rewardCycleEnd = await ctx.sfrxEth.rewardsCycleEnd()
  const nextTimestamp = await getLatestBlockTimestamp()
  if (nextTimestamp < rewardCycleEnd) {
    await setNextBlockTimestamp(rewardCycleEnd + 1)
    await hre.network.provider.send('evm_mine', [])
  }
  await ctx.sfrxEth.syncRewards()
  await advanceBlocks(1200 / 12)
  await advanceTime(1200)
  // push chainlink oracle forward so that tryPrice() still works
  const lastAnswer = await ctx.chainlinkFeed.latestAnswer()
  await ctx.chainlinkFeed.updateAnswer(lastAnswer)
}

const getExpectedPrice = async (ctx: SFrxEthCollateralFixtureContext): Promise<BigNumber> => {
  // Peg Feed
  const clData = await ctx.chainlinkFeed.latestRoundData()
  const clDecimals = await ctx.chainlinkFeed.decimals()

  // Target Unit Feed
  // const tgtClData = await ctx.targetPerRefChainlinkFeed.latestRoundData()
  // const tgtClDecimals = await ctx.targetPerRefChainlinkFeed.decimals()

  const refPerTok = await ctx.collateral.refPerTok()

  const expectedPegPrice = clData.answer.mul(bn(10).pow(18 - clDecimals))
  // const expectedTgtPrice = tgtClData.answer.mul(bn(10).pow(18 - tgtClDecimals))
  return (
    expectedPegPrice
      // .mul(expectedTgtPrice)
      .mul(refPerTok)
      // .div(fp('1'))
      .div(fp('1'))
  )
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
  itChecksTargetPerRefDefault: it.skip,
  itChecksRefPerTokDefault: it.skip,
  itChecksPriceChanges: it,
  resetFork,
  collateralName: 'SFraxEthCollateral',
  chainlinkDefaultAnswer,
}

collateralTests(opts)
